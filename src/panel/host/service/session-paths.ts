/**
 * 会话存储的路径约定（移植自 dsh-session-admin 的 `lib/paths.js`）。
 *
 * 全部是普通 Node：这些函数在 host 半里只做路径推导与磁盘测量，不碰 DSH 服务，
 * 也不依赖任何随宿主发布的包。目录布局对齐宿主后端（对着 dsh 0.2.1-rc.5 核过）：
 *
 *   sessions/<projectKey>/<encodeSegment(sessionId)>/session.v<N>.jsonl.zstd
 *   storages/<domain>/<table>/<sessionId>.json
 *   attachments/v1/{objects,file-objects,files}/...
 *
 * 为什么单独一份而不是复用 `utils/paths.utils.ts`：那份是 panel 的 profile/技能路径，
 * 语义完全不同（这里是「用户 DSH_HOME 下的会话数据」），合在一起会让两边互相牵制。
 */
import type { Dirent } from 'node:fs'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** 会话 id 的白名单：UUID 与 `session-<uuid>` 都能过，长度上限 200。 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const SAFE_UNIT = /^[A-Za-z0-9._-]$/

/** 该插件读写的根，全部来自 DSH_HOME 或行配置覆盖。 */
export interface SessionRoots {
  home: string
  sessions: string
  storages: string
  attachments: string
  uploadIndex: string
}

export interface SessionRootsConfig {
  dshHome?: string
  sessionsRoot?: string
  storagesRoot?: string
  attachmentsRoot?: string
}

/**
 * 请求里的 id 是否可用作单段路径。
 * @param value 候选 id
 */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string'
    && ID_PATTERN.test(value)
    && value !== '.'
    && value !== '..'
}

/** 把会话 id 编码成存储后端的目录段：ASCII 安全字符原样，其余按 UTF-16 码元写成 `~XXXX`。 */
export function encodeSegment(id: string): string {
  if (id === '.' || id === '..')
    return id.replaceAll('.', '~002E')
  let out = ''
  for (let index = 0; index < id.length; index += 1) {
    const unit = id[index]
    if (SAFE_UNIT.test(unit))
      out += unit
    else
      out += `~${id.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** 目录段还原成会话 id（没有转义时原样返回）。 */
export function decodeSegment(segment: string): string {
  return segment.replace(/~([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/**
 * 解析 DSH home 与各根目录。
 *
 * `DSH_HOME` 优先（桌面壳与 `dsh` 都会设）；都没有时退回 `~/.dsh`。每个根都能被行配置覆盖，
 * 以支持非标准部署——但**不要**在别处再读一次 env，否则两边会漂移。
 */
export function resolveRoots(config: SessionRootsConfig = {}): SessionRoots {
  const home = path.resolve(
    typeof config.dshHome === 'string' && config.dshHome !== ''
      ? config.dshHome
      : process.env.DSH_HOME || path.join(homedir(), '.dsh'),
  )
  return {
    home,
    sessions: path.resolve(config.sessionsRoot || path.join(home, 'sessions')),
    storages: path.resolve(config.storagesRoot || path.join(home, 'storages')),
    attachments: path.resolve(config.attachmentsRoot || path.join(home, 'attachments', 'v1')),
    uploadIndex: path.join(home, 'llm-deepseek', 'files-v3.json'),
  }
}

/** `target` 是否严格落在 `root` 内（相等不算，防止把根本身删掉）。 */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** 汇总一个目录下普通文件的体积，不跟随符号链接。 */
export async function measureTree(directory: string): Promise<{ bytes: number, files: number }> {
  let bytes = 0
  let files = 0
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  }
  catch (error: any) {
    if (error?.code === 'ENOENT')
      return { bytes: 0, files: 0 }
    throw error
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await measureTree(absolute)
      bytes += nested.bytes
      files += nested.files
      continue
    }
    if (!entry.isFile())
      continue // 符号链接与特殊文件永不跟随
    try {
      const info = await lstat(absolute)
      bytes += info.size
      files += 1
    }
    catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw error
    }
  }
  return { bytes, files }
}

/**
 * 删掉一整棵目录（含 Windows 只读文件）。
 *
 * 为什么不用裸 `rm -rf`：Windows 上会话日志目录常带只读位，`fs.rm` 会 EPERM；
 * 先尽力递归 chmod 再删，并对一次瞬时占用做重试（不引入 panel 的 rmtree 服务是因为
 * 这一层要保持纯函数、可在没有 DSH 的测试里直接跑）。
 */
export async function removeTree(absolute: string): Promise<void> {
  try {
    await clearReadOnly(absolute)
  }
  catch {}
  await rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

async function clearReadOnly(absolute: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  }
  catch {
    return
  }
  for (const entry of entries) {
    const child = path.join(absolute, entry.name)
    if (entry.isDirectory()) {
      try {
        await chmod(child, 0o777)
      }
      catch {}
      await clearReadOnly(child)
    }
    else if (entry.isFile()) {
      try {
        await chmod(child, 0o666)
      }
      catch {}
    }
  }
  try {
    await chmod(absolute, 0o777)
  }
  catch {}
}

/**
 * 找到每个会话 id 对应的日志目录。
 *
 * 目录名只取决于编码后的 id，而项目目录由会话 header 决定，所以只能枚举所有项目目录。
 * 撞名（两个项目下都有同一 id 的目录）单独报出来而不是猜：猜错会删掉别人的日志。
 */
export async function findSessionDirs(
  sessionsRoot: string,
  ids: Iterable<string>,
): Promise<{ found: Map<string, string>, duplicates: Set<string> }> {
  const wanted = new Map<string, string>()
  for (const id of ids) {
    wanted.set(encodeSegment(id), id)
    // 目录名若被后端按原始 id 落盘（而不是 `~XXXX` 转义），也要能命中：
    // 两个键空间不同，只登记编码键会让这条兜底永远查不到（合法 id 不含 `~`，
    // 编码结果等于自身，所以对当前布局是等价的，属于对将来布局变化的兜底）。
    wanted.set(id, id)
  }
  const found = new Map<string, string>()
  const duplicates = new Set<string>()
  let projects: Dirent[]
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true })
  }
  catch (error: any) {
    if (error?.code === 'ENOENT')
      return { found, duplicates }
    throw error
  }
  for (const project of projects) {
    if (!project.isDirectory())
      continue
    const projectPath = path.join(sessionsRoot, project.name)
    let entries: Dirent[]
    try {
      entries = await readdir(projectPath, { withFileTypes: true })
    }
    catch {
      continue // 读不了的项目目录不可能持有可写的会话
    }
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue
      const direct = wanted.get(entry.name)
      const decoded = direct === undefined ? wanted.get(decodeSegment(entry.name)) : direct
      if (decoded === undefined)
        continue
      if (found.has(decoded)) {
        duplicates.add(decoded)
        continue
      }
      found.set(decoded, path.join(projectPath, entry.name))
    }
  }
  return { found, duplicates }
}

/** 投影缓存的单文件路径。 */
export function projectionCachePath(storagesRoot: string, id: string): string {
  return path.join(storagesRoot, 'session_projcache', 'sessions', `${id}.json`)
}

/** 投影缓存目录。 */
export function projectionCacheDir(storagesRoot: string): string {
  return path.join(storagesRoot, 'session_projcache', 'sessions')
}
