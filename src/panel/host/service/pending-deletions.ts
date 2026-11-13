/**
 * 「下次启动再删」的持久队列（移植自 dsh-session-admin 的 `lib/pending.js`）。
 *
 * 为什么需要它：会话只要在本进程里被打开过，Host 就一直持有 Session/Agent 句柄，
 * 只有句柄所有者（会话控制器）能释放。此时删日志会让后端重建无 header 的日志、
 * 或把投影缓存写回来。所以插件不碰文件，只把意图记进队列，等下一次 Host 启动
 * （那时没有 live 会话）在浏览器打开会话之前执行。
 *
 * 队列文件是插件私有的：`$DSH_HOME/session-admin/pending-deletions.json`。
 * 原子写（临时文件 + rename）且有条数上限，损坏或被手改的文件最多让宿主删一个有限的列表。
 *
 * 目录名沿用 `session-admin` 而不是改成插件名：老版本的队列（以及 restart.log）就在这里，
 * 换目录会让已排队的删除意图静默失效。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isValidSessionId } from './session-paths'

/** 队列文件 schema 版本。 */
export const PENDING_VERSION = 1
/** 队列条数上限。 */
export const PENDING_MAX = 500

/** 插件状态目录（队列、重启计划、重启日志共用）。 */
export function pluginStateDir(home: string): string {
  return path.join(home, 'session-admin')
}

/** 队列文件绝对路径。 */
export function pendingFilePath(home: string): string {
  return path.join(pluginStateDir(home), 'pending-deletions.json')
}

/** 队列条目（浏览器可见形状 + 重试痕迹）。 */
export interface PendingEntry {
  id: string
  requestedAt: string
  cleanupAttachments: boolean
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
}

function normalizeEntry(raw: Record<string, unknown>): PendingEntry {
  return {
    id: String(raw.id),
    requestedAt: typeof raw.requestedAt === 'string' ? raw.requestedAt : new Date(0).toISOString(),
    cleanupAttachments: raw.cleanupAttachments !== false,
    attempts: Number.isSafeInteger(raw.attempts) && (raw.attempts as number) >= 0 ? raw.attempts as number : 0,
    lastError: typeof raw.lastError === 'string' && raw.lastError !== '' ? raw.lastError : null,
    lastAttemptAt: typeof raw.lastAttemptAt === 'string' ? raw.lastAttemptAt : null,
  }
}

/**
 * 读队列。
 *
 * 文件不存在＝空队列；文件损坏**抛错**而不是当空处理——静默重置会丢掉用户的删除意图，
 * 该由调用方决定是提示还是重试。
 */
export async function readPending(home: string): Promise<PendingEntry[]> {
  let text: string
  try {
    text = await readFile(pendingFilePath(home), 'utf8')
  }
  catch (error: any) {
    if (error?.code === 'ENOENT')
      return []
    throw error
  }
  let data: any
  try {
    data = JSON.parse(text)
  }
  catch (error) {
    throw new Error(`pending deletion file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (data === null || typeof data !== 'object' || data.version !== PENDING_VERSION || !Array.isArray(data.entries))
    throw new Error('pending deletion file has an unsupported shape')
  const entries: PendingEntry[] = []
  const seen = new Set<string>()
  for (const raw of data.entries) {
    if (raw === null || typeof raw !== 'object' || !isValidSessionId(raw.id))
      continue
    if (seen.has(raw.id))
      continue
    seen.add(raw.id)
    entries.push(normalizeEntry(raw))
  }
  return entries
}

/** 原子替换队列。 */
export async function writePending(home: string, entries: PendingEntry[]): Promise<void> {
  if (entries.length > PENDING_MAX)
    throw new Error(`pending deletion queue exceeds ${PENDING_MAX} entries`)
  const file = pendingFilePath(home)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = JSON.stringify({ version: PENDING_VERSION, entries }, null, 2)
  await writeFile(temporary, body, { mode: 0o600 })
  try {
    await renameWithRetry(temporary, file)
  }
  catch (error) {
    // 失败时清掉临时文件：否则每次重试都会在状态目录里留一个孤儿。
    try {
      await rm(temporary, { force: true })
    }
    catch {}
    throw error
  }
}

/**
 * Windows 上 `rename` 覆盖已存在目标会被索引器 / 杀软 / 另一个实例短暂挡住（EPERM/EBUSY）。
 *
 * 队列写入失败不是数据损坏（原子替换保证不会写出半截文件），但会让「删除意图」丢一次，
 * 所以按退避重试几次；非这几类错误立刻抛。
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rename(from, to)
      return
    }
    catch (error: any) {
      lastError = error
      const code = error?.code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')
        throw error
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  throw lastError
}

/** 为一条「现在还删不掉」的会话构造队列条目。 */
export function createPendingEntry(id: string, cleanupAttachments: boolean): PendingEntry {
  return {
    id,
    requestedAt: new Date().toISOString(),
    cleanupAttachments: cleanupAttachments !== false,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  }
}
