/**
 * `session-paths` 的规格测试（语义 1:1 移植自 dsh-session-admin 的 `test/paths.test.mjs`）。
 *
 * 两条移植原则：
 *  - 所有落盘动作都发生在 `mkdtemp` 出来的临时目录里，绝不允许碰真实 `~/.dsh`；
 *  - 路径断言一律用 `path.join` / `path.resolve` 拼出来再比，不写死 `/` 或 `C:\`，
 *    这样在 Windows 与 POSIX 上表达的都是同一件事（上游那版有 `C:\a` 与 `C:\ab` 的硬编码，
 *    在 POSIX 上会因为反斜杠不是分隔符而失效）。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeSegment,
  encodeSegment,
  findSessionDirs,
  isInside,
  isValidSessionId,
  measureTree,
  projectionCachePath,
  resolveRoots,
} from './session-paths'

/** 每个用例自己的临时工作区，afterEach 统一清掉（即便断言中途失败）。 */
const workspaces: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  workspaces.push(dir)
  return dir
}

afterEach(async () => {
  // Windows 上刚写过的文件可能被索引器短暂占用，所以带 maxRetries 而不是裸 rm。
  await Promise.all(workspaces.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })))
})

describe('encodeSegment / decodeSegment', () => {
  it('keeps safe ids literal and round-trips escapes', () => {
    expect(encodeSegment('session-1d8f7019-9eec')).toBe('session-1d8f7019-9eec')
    expect(encodeSegment('a b')).toBe('a~0020b')
    expect(encodeSegment('地理标志')).toBe('~5730~7406~6807~5FD7')
    expect(decodeSegment(encodeSegment('地理标志'))).toBe('地理标志')
    expect(decodeSegment(encodeSegment('session-abc_1.2'))).toBe('session-abc_1.2')
  })

  it('escapes dot-only names', () => {
    expect(encodeSegment('.')).toBe('~002E')
    expect(encodeSegment('..')).toBe('~002E~002E')
  })
})

describe('isValidSessionId', () => {
  it('rejects path syntax', () => {
    expect(isValidSessionId('session-00d57b62-bd2f-4ac2-a45c-3dd6a1651502')).toBe(true)
    expect(isValidSessionId('166b0c10-edb2-4d0d-8988-198f51d2b6f2')).toBe(true)
    expect(isValidSessionId('../escape')).toBe(false)
    expect(isValidSessionId('a/b')).toBe(false)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('.')).toBe(false)
    expect(isValidSessionId('..')).toBe(false)
    expect(isValidSessionId(42)).toBe(false)
    expect(isValidSessionId('x'.repeat(201))).toBe(false)
  })
})

describe('resolveRoots', () => {
  it('honours overrides and defaults to the DSH home layout', () => {
    const home = path.join(tmpdir(), 'dsa-home')
    // 带一段 `..` 的覆盖值：既验证「覆盖优先」，也验证返回值被 path.resolve 规范化过。
    const sessionsOverride = path.join(tmpdir(), 'dsa-data', '..', 'dsa-data', 'sessions')
    const storagesOverride = path.join(tmpdir(), 'dsa-data', 'storages')
    const attachmentsOverride = path.join(tmpdir(), 'dsa-data', 'attachments')

    const roots = resolveRoots({
      dshHome: home,
      sessionsRoot: sessionsOverride,
      storagesRoot: storagesOverride,
      attachmentsRoot: attachmentsOverride,
    })
    expect(roots.home).toBe(path.resolve(home))
    expect(roots.sessions).toBe(path.resolve(sessionsOverride))
    expect(roots.storages).toBe(path.resolve(storagesOverride))
    expect(roots.attachments).toBe(path.resolve(attachmentsOverride))
    expect(roots.uploadIndex).toBe(path.join(path.resolve(home), 'llm-deepseek', 'files-v3.json'))

    const fallback = resolveRoots({ dshHome: home })
    expect(fallback.sessions).toBe(path.join(path.resolve(home), 'sessions'))
    expect(fallback.storages).toBe(path.join(path.resolve(home), 'storages'))
    expect(fallback.attachments).toBe(path.join(path.resolve(home), 'attachments', 'v1'))
  })
})

describe('isInside', () => {
  it('refuses the root itself and siblings', () => {
    const root = path.join(tmpdir(), 'dsa-inside')
    expect(isInside(root, path.join(root, 'b'))).toBe(true)
    expect(isInside(root, root)).toBe(false)
    // 前缀相同的兄弟目录（`dsa-inside` vs `dsa-inside-sibling`）必须判成外部，
    // 否则按字符串前缀实现的版本会误删别人。
    expect(isInside(root, path.join(`${root}-sibling`, 'c'))).toBe(false)
    expect(isInside(root, path.join(tmpdir(), 'dsa-elsewhere', 'c'))).toBe(false)
  })
})

describe('measureTree', () => {
  it('sums regular files below the directory', async () => {
    const root = await workspace('dsa-measure-')
    await mkdir(path.join(root, 'nested'), { recursive: true })
    await writeFile(path.join(root, 'a.txt'), 'x'.repeat(10))
    await writeFile(path.join(root, 'nested', 'b.txt'), 'x'.repeat(25))
    const measured = await measureTree(root)
    expect(measured).toEqual({ bytes: 35, files: 2 })
    expect(await measureTree(path.join(root, 'missing'))).toEqual({ bytes: 0, files: 0 })
  })
})

describe('findSessionDirs', () => {
  it('locates encoded directories and reports collisions', async () => {
    const root = await workspace('dsa-find-')
    const id = 'session-abc-def'
    const segment = encodeSegment(id)
    await mkdir(path.join(root, '--project-one--', segment), { recursive: true })
    await mkdir(path.join(root, '--project-two--'), { recursive: true })

    const first = await findSessionDirs(root, [id, 'session-missing'])
    expect(first.found.get(id)).toBe(path.join(root, '--project-one--', segment))
    expect(first.duplicates.size).toBe(0)

    // 第二个项目下出现同名目录：不能猜，必须报撞名。
    await mkdir(path.join(root, '--project-two--', segment), { recursive: true })
    const second = await findSessionDirs(root, [id])
    expect(second.duplicates.has(id)).toBe(true)
    expect(second.found.has(id)).toBe(true)
  })

  it('tolerates a missing sessions root', async () => {
    const root = await workspace('dsa-missing-')
    const located = await findSessionDirs(path.join(root, 'nope'), ['session-x'])
    expect(located.found.size).toBe(0)
    expect(located.duplicates.size).toBe(0)
  })
})

describe('projectionCachePath', () => {
  it('uses the per-record layout', () => {
    const storagesRoot = path.join(tmpdir(), 'dsa-storages')
    expect(projectionCachePath(storagesRoot, 'session-x'))
      .toBe(path.join(storagesRoot, 'session_projcache', 'sessions', 'session-x.json'))
  })
})
