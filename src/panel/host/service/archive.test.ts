/**
 * `archive` 的规格测试（语义 1:1 移植自 dsh-session-admin 的 `test/archive.test.mjs`）。
 *
 * 这里覆盖的是「删除已归档会话」的完整决策链：只有注册表里处于归档态的会话可删、
 * live 会话改为排队、subagent 后代跟着父会话走、附件只在完整引用扫描后删、
 * 取消归档即刻撤销删除意图、启动清扫逐条重新校验。
 *
 * 三条移植约定：
 *  - 假 ctx 用 `Map` 装服务 + `logger.warn`（`createArchiveAdmin` 只用到这两个），
 *    与真实宿主「服务缺失时返回 503 而不是抛错」的形状一致；
 *  - 每个用例的 dshHome / sessions / storages / attachments 全指向 `mkdtemp` 出来的目录，
 *    **绝不**碰真实 `~/.dsh`；
 *  - 目录段一律用 `encodeSegment` / `path.join` 生成，不写死分隔符（Windows 也要绿）。
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchiveRequestError, createArchiveAdmin, validateIds } from './archive'
import { pendingFilePath } from './pending-deletions'
import { attachmentPaths } from './session-attachments'
import { encodeSegment, projectionCachePath } from './session-paths'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const ID_A = `sha256:${HASH_A}`
const ID_B = `sha256:${HASH_B}`
const ID_C = `sha256:${HASH_C}`

const workspaces: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  workspaces.push(dir)
  return dir
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  }
  catch {
    return false
  }
}

afterEach(async () => {
  // 队列清理走 setTimeout（`schedulePrune`）或已完成的序列队列，这里带 maxRetries
  // 是为了 Windows 上「文件刚被写过还占着句柄」的瞬时 EPERM。
  await Promise.all(workspaces.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })))
})

interface HarnessOptions {
  root: string
  archived: string[]
  workspaces?: any[]
  headers?: any[]
  events?: (sessionId: string) => Promise<any>
  live?: (sessionId: string) => any
}

interface Harness {
  admin: ReturnType<typeof createArchiveAdmin>
  calls: { archive: string[], unarchive: string[], unpin: string[], detach: string[] }
  sessions: string
  storages: string
  attachments: string
}

/** 用 Map 造一个只带 archive admin 需要的服务的假 ctx。 */
function harness(options: HarnessOptions): Harness {
  const {
    root,
    archived,
    workspaces = [],
    headers = [],
    events = async () => [],
    live = () => undefined,
  } = options
  const sessions = path.join(root, 'sessions')
  const storages = path.join(root, 'storages')
  const attachments = path.join(root, 'attachments', 'v1')
  const calls = { archive: [] as string[], unarchive: [] as string[], unpin: [] as string[], detach: [] as string[] }
  const registry = {
    archivedSessionIds: [...archived],
    list: () => workspaces,
    get: () => undefined,
    archiveSession: async (id: string) => {
      calls.archive.push(id)
    },
    unarchiveSession: async (id: string) => {
      calls.unarchive.push(id)
    },
    unpinSession: async (id: string) => {
      calls.unpin.push(id)
    },
  }
  const persistence = {
    list: async () => headers.map(header => ({ header })),
  }
  const services = new Map<string, any>([
    ['workspaceRegistry', registry],
    ['sessionPersistence', persistence],
    ['sessionQuery', { listEvents: (id: string) => events(id) }],
    ['sessions', { get: (id: string) => live(id) }],
  ])
  const ctx = {
    get: (name: string) => services.get(name),
    logger: { warn: () => {} },
  }
  const config = {
    dshHome: root,
    sessionsRoot: sessions,
    storagesRoot: storages,
    attachmentsRoot: attachments,
  }
  const admin = createArchiveAdmin(ctx, config)
  return { admin, calls, sessions, storages, attachments }
}

/** 建一个会话日志目录 + 对应的投影缓存记录。 */
async function layoutSession(root: string, id: string, { logBytes = 100, cacheBytes = 50 } = {}): Promise<{ directory: string, cache: string }> {
  const sessions = path.join(root, 'sessions')
  const directory = path.join(sessions, '--project--', encodeSegment(id))
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'session.v4.jsonl.zstd'), 'x'.repeat(logBytes))
  const cache = projectionCachePath(path.join(root, 'storages'), id)
  await mkdir(path.dirname(cache), { recursive: true })
  await writeFile(cache, 'x'.repeat(cacheBytes))
  return { directory, cache }
}

/** 建一个附件对象的三处落盘位置（objects / file-objects / files 别名）。 */
async function layoutAttachment(
  attachments: string,
  digest: string,
  name: string,
  size = 10,
): Promise<{ object: string, fileObject: string, fileAlias: string }> {
  const paths = attachmentPaths(attachments, digest)
  await mkdir(path.dirname(paths.object), { recursive: true })
  await mkdir(path.dirname(paths.fileObject), { recursive: true })
  await mkdir(paths.fileAlias, { recursive: true })
  await writeFile(paths.object, 'x'.repeat(size))
  await writeFile(paths.fileObject, 'x'.repeat(size))
  await writeFile(path.join(paths.fileAlias, name), 'x'.repeat(size))
  return paths
}

/** 断言同步抛出的 `ArchiveRequestError` 带指定机器码。 */
function expectRequestError(run: () => unknown, code: string): void {
  let caught: any
  try {
    run()
  }
  catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ArchiveRequestError)
  expect(caught.code).toBe(code)
}

describe('validateIds', () => {
  it('rejects unsafe and oversized input', () => {
    expect(validateIds(['session-a', 'session-a', 'session-b'])).toEqual(['session-a', 'session-b'])
    expectRequestError(() => validateIds([]), 'invalid-request')
    expectRequestError(() => validateIds(['../x']), 'invalid-id')
    expectRequestError(() => validateIds(Array.from({ length: 101 }, (_, index) => `session-${index}`)), 'too-many')
  })
})

describe('archive.list', () => {
  it('reports archived sessions with their footprint', async () => {
    const root = await workspace('dsa-list-')
    const id = 'session-abc'
    await layoutSession(root, id)
    const { admin } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const inventory = await admin.list()
    expect(inventory.items.length).toBe(1)
    expect(inventory.items[0].id).toBe(id)
    expect(inventory.items[0].workspaceId).toBe('ws-1')
    expect(inventory.items[0].hasLog).toBe(true)
    expect(inventory.items[0].logBytes).toBe(100)
    expect(inventory.items[0].cacheBytes).toBe(50)
    expect(inventory.items[0].totalBytes).toBe(150)
    expect(inventory.totals.bytes).toBe(150)
  })

  it('prunes a pending intent for a session that is no longer archived', async () => {
    const root = await workspace('dsa-prune-list-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const pending = pendingFilePath(root)
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: true, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin } = harness({ root, archived: [], headers: [{ id, cwd: path.join(root, 'project') }] })
    const listed = await admin.list()
    expect(listed.totals.pending).toBe(0)
    // 页面读取只「安排」一次合并过的 prune；给它时间跑完（100ms 合并窗口 + 落盘）。
    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
    const queue = JSON.parse(await readFile(pending, 'utf8'))
    expect(queue.entries).toEqual([])
    // prune 只清意图，绝不删文件。
    expect(await exists(layout.directory)).toBe(true)
  })
})

describe('archive.plan', () => {
  it('measures without deleting anything', async () => {
    const root = await workspace('dsa-plan-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const { admin, calls } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const planned = await admin.plan([id])
    expect(planned.items[0].ok).toBe(true)
    expect(planned.items[0].totalBytes).toBe(150)
    expect(planned.totals.count).toBe(1)
    expect(await exists(layout.directory)).toBe(true)
    expect(await exists(layout.cache)).toBe(true)
    expect(calls.unarchive).toEqual([])
  })

  it('marks a live session as queued instead of invalid', async () => {
    const root = await workspace('dsa-plan-live-')
    const id = 'session-abc'
    await layoutSession(root, id)
    const { admin } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
      live: (sessionId: string) => (sessionId === id ? { id } : undefined),
    })
    const planned = await admin.plan([id])
    expect(planned.items[0].ok).toBe(true)
    expect(planned.items[0].willQueue).toBe(true)
    expect(planned.totals.immediate).toBe(0)
    expect(planned.totals.queued).toBe(1)
  })
})

describe('archive.remove', () => {
  /**
   * 2.7.1 起 `remove` **只排队**：真正的删除与归档记录清理都在启动 sweep 里做
   * （否则当场清墓碑会让宿主内存里的会话在原生侧栏变成「未分类」空壳）。
   * 所以「删掉了什么」要分两次看：先断言排队与磁盘未动，再跑一次 sweep 断言真正删除。
   */
  it('删除先排队：日志/缓存/归档记录都在启动 sweep 时才消失', async () => {
    const root = await workspace('dsa-remove-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const { admin, calls } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const result = await admin.remove([id], { cleanupAttachments: false })
    expect(result.results[0]).toMatchObject({ deleted: false, queued: true })
    expect(result.totals).toMatchObject({ deleted: 0, queued: 1, freedBytes: 0 })
    // 磁盘一处都没动，归档墓碑也还在（这正是「侧栏不会冒出未分类」的原因）。
    expect(await exists(layout.directory)).toBe(true)
    expect(await exists(layout.cache)).toBe(true)
    expect(calls.unarchive).toEqual([])
    // 排队项不再出现在列表里，只回一个 id 给页面显示「N 条已排队 · 取消」。
    const listed = await admin.list()
    expect(listed.items).toEqual([])
    expect(listed.pendingIds).toEqual([id])
    expect(listed.totals.pending).toBe(1)

    const swept = await admin.sweepPending()
    expect(swept.totals.deleted).toBe(1)
    expect(swept.totals.freedBytes).toBe(150)
    expect(await exists(layout.directory)).toBe(false)
    expect(await exists(layout.cache)).toBe(false)
    expect(calls.unarchive).toEqual([id])
  })

  it('日志与缓存早就不在了：排队后仍会在 sweep 里清掉归档记录', async () => {
    const root = await workspace('dsa-orphan-')
    const id = 'session-ghost'
    const { admin, calls } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const planned = await admin.plan([id])
    expect(planned.items[0].ok).toBe(true)
    expect(planned.items[0].hasLog).toBe(false)
    expect(planned.items[0].totalBytes).toBe(0)

    const result = await admin.remove([id], { cleanupAttachments: false })
    expect(result.results[0].queued).toBe(true)
    expect(result.totals.freedBytes).toBe(0)
    expect(calls.unarchive).toEqual([])

    const swept = await admin.sweepPending()
    expect(swept.totals.deleted).toBe(1)
    expect(calls.unarchive).toEqual([id])
  })

  it('live 会话与非归档 id：同样只排队 / 被拒绝', async () => {
    const root = await workspace('dsa-refuse-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const harnessLive = harness({
      root,
      archived: [id],
      headers: [{ id, cwd: path.join(root, 'project') }],
      live: (sessionId: string) => (sessionId === id ? { id } : undefined),
    })
    const liveResult = await harnessLive.admin.remove([id], { cleanupAttachments: false })
    expect(liveResult.results[0].deleted).toBe(false)
    expect(liveResult.results[0].queued).toBe(true)
    expect(liveResult.totals.queued).toBe(1)
    expect(liveResult.totals.deleted).toBe(0)
    // 会话活着时，磁盘上一处都不许动，sweep 也会把它留在队列里。
    expect(await exists(layout.directory)).toBe(true)
    expect(await exists(layout.cache)).toBe(true)
    const listed = await harnessLive.admin.list()
    expect(listed.pendingIds).toEqual([id])
    expect(listed.totals.pending).toBe(1)
    const swept = await harnessLive.admin.sweepPending()
    expect(swept.totals.kept).toBe(1)
    expect(await exists(layout.directory)).toBe(true)

    const harnessOther = harness({
      root,
      archived: [],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const otherResult = await harnessOther.admin.remove([id], { cleanupAttachments: false })
    expect(otherResult.results[0].deleted).toBe(false)
    expect(otherResult.results[0].code).toBe('not-archived')
  })

  it('附件清理跟着排队项走：sweep 时才只删没人引用的那些', async () => {
    const root = await workspace('dsa-attach-remove-')
    const target = 'session-abc'
    const keep = 'session-keep'
    await layoutSession(root, target)
    await layoutSession(root, keep)
    const { admin, attachments } = harness({
      root,
      archived: [target],
      headers: [
        { id: target, cwd: path.join(root, 'project') },
        { id: keep, cwd: path.join(root, 'project') },
      ],
      events: async (sessionId: string) => {
        if (sessionId === target)
          return [{ data: { a: ID_A, c: ID_C } }]
        if (sessionId === keep)
          return [{ data: { b: ID_B } }]
        return []
      },
    })
    const pathsA = await layoutAttachment(attachments, HASH_A, 'a.txt')
    const pathsB = await layoutAttachment(attachments, HASH_B, 'b.txt')
    const pathsC = await layoutAttachment(attachments, HASH_C, 'c.txt')

    const result = await admin.remove([target], { cleanupAttachments: true })
    expect(result.results[0].queued).toBe(true)
    // 排队阶段一个附件都不碰。
    expect(await exists(pathsA.object)).toBe(true)
    expect(await exists(pathsC.object)).toBe(true)

    await admin.sweepPending()
    expect(await exists(pathsA.object)).toBe(false)
    expect(await exists(pathsC.object)).toBe(false)
    expect(await exists(pathsB.object)).toBe(true)
    expect(await exists(path.join(pathsB.fileAlias, 'b.txt'))).toBe(true)
  })

  it('引用扫描不完整时一个附件都不删（sweep 之后仍然如此）', async () => {
    const root = await workspace('dsa-attach-skip-')
    const target = 'session-abc'
    const keep = 'session-keep'
    await layoutSession(root, target)
    const { admin, attachments } = harness({
      root,
      archived: [target],
      headers: [
        { id: target, cwd: path.join(root, 'project') },
        { id: keep, cwd: path.join(root, 'project') },
      ],
      events: async (sessionId: string) => {
        if (sessionId === target)
          return [{ data: { a: ID_A } }]
        throw new Error('unreadable')
      },
    })
    const pathsA = await layoutAttachment(attachments, HASH_A, 'a.txt')
    const result = await admin.remove([target], { cleanupAttachments: true })
    expect(result.results[0].queued).toBe(true)
    await admin.sweepPending()
    expect(await exists(pathsA.object)).toBe(true)
  })

  it('subagent 后代跟着父会话走：sweep 时一起删，无关会话留下', async () => {
    const root = await workspace('dsa-desc-')
    const parent = 'session-parent'
    const child = 'session-child'
    const unrelated = 'session-unrelated'
    const parentLayout = await layoutSession(root, parent)
    const childLayout = await layoutSession(root, child)
    const unrelatedLayout = await layoutSession(root, unrelated)
    const { admin, calls } = harness({
      root,
      archived: [parent],
      headers: [
        { id: parent, cwd: path.join(root, 'project') },
        { id: child, cwd: path.join(root, 'project'), origin: 'subagent', parentSession: parent },
        { id: unrelated, cwd: path.join(root, 'project') },
      ],
    })
    const result = await admin.remove([parent], { cleanupAttachments: false })
    // 排队阶段不算后代（那段计算在真正的删除分支里），这里只断言「已排队、磁盘未动」。
    expect(result.results[0]).toMatchObject({ queued: true })
    expect(await exists(parentLayout.directory)).toBe(true)

    await admin.sweepPending()
    expect(await exists(parentLayout.directory)).toBe(false)
    expect(await exists(childLayout.directory)).toBe(false)
    expect(await exists(unrelatedLayout.directory)).toBe(true)
    expect(calls.archive).toEqual([child])
    expect(calls.unarchive.includes(child)).toBe(true)
    expect(calls.unarchive.includes(parent)).toBe(true)
  })
})

describe('archive.cancelPending', () => {
  it('drops a queued deletion without touching disk', async () => {
    const root = await workspace('dsa-cancel-pending-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const harnessLive = harness({
      root,
      archived: [id],
      headers: [{ id, cwd: path.join(root, 'project') }],
      live: (sessionId: string) => (sessionId === id ? { id } : undefined),
    })
    await harnessLive.admin.remove([id], { cleanupAttachments: false })
    const cancelled = await harnessLive.admin.cancelPending([id, 'session-other'])
    expect(cancelled.totals.cancelled).toBe(1)
    expect(cancelled.results[0].cancelled).toBe(true)
    expect(cancelled.results[1].cancelled).toBe(false)
    const listed = await harnessLive.admin.list()
    expect(listed.pendingIds).toEqual([])
    expect(await exists(layout.directory)).toBe(true)
    expect(await exists(layout.cache)).toBe(true)
  })
})

describe('archive.sweepPending', () => {
  it('deletes a queued session once no agent is live', async () => {
    const root = await workspace('dsa-sweep-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const pending = path.join(root, 'session-admin', 'pending-deletions.json')
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: true, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin, calls } = harness({
      root,
      archived: [id],
      workspaces: [{ id: 'ws-1', title: 'Project', sessionIds: [id] }],
      headers: [{ id, cwd: path.join(root, 'project') }],
    })
    const swept = await admin.sweepPending()
    expect(swept.totals.deleted).toBe(1)
    expect(swept.totals.kept).toBe(0)
    expect(await exists(layout.directory)).toBe(false)
    expect(await exists(layout.cache)).toBe(false)
    expect(calls.unarchive).toEqual([id])
    const listed = await admin.list()
    expect(listed.totals.pending).toBe(0)
    const queue = JSON.parse(await readFile(pending, 'utf8'))
    expect(queue.entries).toEqual([])
  })

  it('drops an intent when the session was unarchived', async () => {
    const root = await workspace('dsa-sweep-drop-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const pending = path.join(root, 'session-admin', 'pending-deletions.json')
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: true, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin } = harness({ root, archived: [], headers: [{ id, cwd: path.join(root, 'project') }] })
    const swept = await admin.sweepPending()
    expect(swept.totals.deleted).toBe(0)
    expect(swept.totals.dropped).toBe(1)
    expect(await exists(layout.directory)).toBe(true)
  })

  it('keeps an intent while the session is still live', async () => {
    const root = await workspace('dsa-sweep-live-')
    const id = 'session-abc'
    const layout = await layoutSession(root, id)
    const pending = path.join(root, 'session-admin', 'pending-deletions.json')
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: false, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin } = harness({
      root,
      archived: [id],
      headers: [{ id, cwd: path.join(root, 'project') }],
      live: (sessionId: string) => (sessionId === id ? { id } : undefined),
    })
    const swept = await admin.sweepPending()
    expect(swept.totals.deleted).toBe(0)
    expect(swept.totals.kept).toBe(1)
    expect(await exists(layout.directory)).toBe(true)
    const queue = JSON.parse(await readFile(pending, 'utf8'))
    expect(queue.entries[0].lastError).toBe('session-live')
    expect(queue.entries[0].attempts).toBe(1)
  })
})

describe('archive.unarchive', () => {
  it('reports the sessions it changed', async () => {
    const root = await workspace('dsa-unarchive-')
    const id = 'session-abc'
    const { admin, calls } = harness({ root, archived: [id], headers: [{ id, cwd: path.join(root, 'project') }] })
    const result = await admin.unarchive([id, 'session-other'])
    expect(result.totals.unarchived).toBe(1)
    expect(calls.unarchive).toEqual([id])
    expect(result.results[1].code).toBe('not-archived')
  })

  it('clears a queued deletion for the same session', async () => {
    const root = await workspace('dsa-unarchive-queue-')
    const id = 'session-abc'
    const pending = pendingFilePath(root)
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: true, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin } = harness({ root, archived: [id], headers: [{ id, cwd: path.join(root, 'project') }] })
    await admin.unarchive([id])
    const queue = JSON.parse(await readFile(pending, 'utf8'))
    expect(queue.entries).toEqual([])
  })
})

describe('archive.prunePending', () => {
  it('keeps intents for sessions that are still archived', async () => {
    const root = await workspace('dsa-prune-keep-')
    const id = 'session-abc'
    const pending = pendingFilePath(root)
    await mkdir(path.dirname(pending), { recursive: true })
    await writeFile(pending, JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: true, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))
    const { admin } = harness({ root, archived: [id], headers: [{ id, cwd: path.join(root, 'project') }] })
    const pruned = await admin.prunePending()
    expect(pruned.removed).toEqual([])
    const queue = JSON.parse(await readFile(pending, 'utf8'))
    expect(queue.entries.length).toBe(1)
  })
})
