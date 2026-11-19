/**
 * 已归档会话的删除/取消归档/队列维护（移植自 dsh-session-admin 的 `lib/archive.js`）。
 *
 * DSH 只提供归档/取消归档，没有永久删除会话的入口。这里把缺失的那一步在本地做掉，
 * 并遵守宿主架构要求的边界：
 *
 *  - 只有注册表里处于归档态的会话可删；live agent 一律拒绝；
 *  - 删的是整棵会话日志目录（绝不截断）；
 *  - 投影缓存走 storageDomain，取不到时按精确文件删；
 *  - subagent 后代跟着父会话一起删，用户 fork 不删；
 *  - 绑定到该会话的定时任务一并删除；
 *  - 附件只在「完整引用扫描」证明无人引用后才删。
 *
 * 所有服务读取都是防御式的：压缩过的 profile 可能没有某些服务，调用方拿到的是明确的错误码，
 * 而不是一次猜出来的写操作。
 */
import type { ArchiveAttachmentOutcome, ArchiveCancelResponse, ArchiveListResponse, ArchivePlanResponse, ArchiveRemoveItemView, ArchiveRemoveResponse, ArchiveSweepResponse, ArchiveUnarchiveResponse, ArchivedSessionView } from './archive.types'
import type { SessionRoots, SessionRootsConfig } from './session-paths'
import type { PendingEntry } from './pending-deletions'
import { lstat, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { extractAttachmentIds, pruneUnreferencedAttachments, scanAttachmentReferences } from './session-attachments'
import { PENDING_MAX, createPendingEntry, readPending, writePending } from './pending-deletions'
import {
  findSessionDirs,
  isInside,
  isValidSessionId,
  measureTree,
  projectionCacheDir,
  projectionCachePath,
  removeTree,
  resolveRoots,
} from './session-paths'

/** 单次请求允许的最大 id 数。 */
export const MAX_BATCH = 100
const REFERENCE_BUDGET = { sessions: 500, events: 200000, milliseconds: 90000 }
const TARGET_REFERENCE_BUDGET = { events: 100000, milliseconds: 30000 }

/** 宿主 ctx 的最小面：只有按名字取服务和 logger。 */
export interface HostServiceHub {
  get?: (name: string) => any
  logger?: { warn?: (message: string) => void, info?: (message: string) => void, error?: (message: string) => void }
  [key: string]: any
}

export interface ArchiveConfig extends SessionRootsConfig {
  cleanupAttachmentsDefault?: boolean
}

/** 带稳定机器码的输入/前置条件失败；路由层据 `code` 映射状态码。 */
export class ArchiveRequestError extends Error {
  code: string
  blockers?: unknown

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArchiveRequestError'
    this.code = code
  }
}

/** 校验客户端传来的 id 列表。 */
export function validateIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0)
    throw new ArchiveRequestError('invalid-request', 'ids must be a non-empty array')
  if (ids.length > MAX_BATCH)
    throw new ArchiveRequestError('too-many', `at most ${MAX_BATCH} sessions per request`)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!isValidSessionId(id))
      throw new ArchiveRequestError('invalid-id', 'session id is not path-safe')
    if (seen.has(id))
      continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

export interface ArchiveAdmin {
  list: () => Promise<ArchiveListResponse>
  plan: (ids: unknown, options?: { cleanupAttachments?: boolean }) => Promise<ArchivePlanResponse>
  remove: (ids: unknown, options?: { cleanupAttachments?: boolean }) => Promise<ArchiveRemoveResponse>
  unarchive: (ids: unknown) => Promise<ArchiveUnarchiveResponse>
  cancelPending: (ids: unknown) => Promise<ArchiveCancelResponse>
  sweepPending: () => Promise<ArchiveSweepResponse>
  prunePending: () => Promise<{ removed: string[], kept: number }>
  schedulePrune: () => void
  roots: SessionRoots
}

/**
 * 构造绑定到一次插件 apply 的 archive admin。
 *
 * @param ctx 宿主 ctx（只用到 `get` 与 `logger`）
 * @param config 行配置：根目录覆盖 + 附件清理默认值
 */
export function createArchiveAdmin(ctx: HostServiceHub, config: ArchiveConfig = {}): ArchiveAdmin {
  const roots = resolveRoots(config)
  const cleanupAttachmentsDefault = config.cleanupAttachmentsDefault !== false
  let tail: Promise<unknown> = Promise.resolve()

  /** 一次只跑一个变更：两个浏览器标签页不能在同一批文件上竞争。 */
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation)
    tail = run.then(() => {}, () => {})
    return run
  }

  const readQueue = (): Promise<PendingEntry[]> => readPending(roots.home)
  const writeQueue = (entries: PendingEntry[]): Promise<void> => writePending(roots.home, entries)
  const pendingView = (entry: PendingEntry): {
    requestedAt: string
    cleanupAttachments: boolean
    attempts: number
    lastError: string | null
    lastAttemptAt: string | null
  } => ({
    requestedAt: entry.requestedAt,
    cleanupAttachments: entry.cleanupAttachments,
    attempts: entry.attempts,
    lastError: entry.lastError,
    lastAttemptAt: entry.lastAttemptAt,
  })

  /**
   * 按名字取可选服务。
   *
   * 为什么不用 `ctx.inject`：把 `sessionPersistence` 之类写进导出的 inject 会让**整个面板**
   * （含 MCP / 技能 tab）在缺该服务的组合下不挂载。这里拿不到就返回 undefined，由调用方报 503。
   */
  const service = (name: string): any => {
    try {
      if (typeof ctx.get === 'function')
        return ctx.get(name)
    }
    catch {}
    try {
      return ctx[name]
    }
    catch {
      return undefined
    }
  }
  const warn = (message: string): void => {
    try {
      service('logger')?.warn?.(message)
      ctx.logger?.warn?.(message)
    }
    catch {}
  }

  const registry = (): any => service('workspaceRegistry')
  const persistence = (): any => service('sessionPersistence')
  const query = (): any => service('sessionQuery')
  const schedule = (): any => service('schedule')
  const liveSession = (id: string): any => service('sessions')?.get?.(id)

  const requireRegistry = (): any => {
    const value = registry()
    if (value === undefined)
      throw new ArchiveRequestError('registry-unavailable', 'the workspace registry is not mounted')
    return value
  }
  const requirePersistence = (): any => {
    const value = persistence()
    if (value === undefined)
      throw new ArchiveRequestError('persistence-unavailable', 'session persistence is not mounted')
    return value
  }

  const archivedSet = (): Set<string> => new Set([...(requireRegistry().archivedSessionIds ?? [])].map(String))

  /** 持久化的会话 header（含已落盘的 live 会话）。 */
  const storedHeaders = async (): Promise<Map<string, any>> => {
    const list = await requirePersistence().list()
    const headers = new Map<string, any>()
    for (const snapshot of list) {
      const header = snapshot?.header
      if (header !== undefined && header.id !== undefined)
        headers.set(String(header.id), header)
    }
    const sessions = service('sessions')
    for (const session of sessions?.list?.() ?? []) {
      const header = session?.header
      if (header !== undefined && header.id !== undefined)
        headers.set(String(header.id), header)
    }
    return headers
  }

  /** 派生的 subagent 子会话（用户 fork 不算）。 */
  const descendantsOf = (id: string, headers: Map<string, any>): string[] => {
    const children = new Map<string, string[]>()
    for (const [sessionId, header] of headers) {
      if (header?.origin !== 'subagent' || header?.parentSession === undefined)
        continue
      const parent = String(header.parentSession)
      if (!children.has(parent))
        children.set(parent, [])
      children.get(parent)!.push(sessionId)
    }
    const out: string[] = []
    const seen = new Set<string>([id])
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const child of children.get(current) ?? []) {
        if (seen.has(child))
          continue
        seen.add(child)
        out.push(child)
        stack.push(child)
      }
    }
    return out
  }

  /** 每个会话 id 的所属工作区（按注册表顺序）。 */
  const ownershipIndex = (): Map<string, any> => {
    const map = new Map<string, any>()
    for (const workspace of registry()?.list?.() ?? []) {
      for (const sessionId of workspace.sessionIds ?? [])
        map.set(String(sessionId), workspace)
    }
    return map
  }

  const fileSize = async (absolute: string): Promise<number> => {
    try {
      const info = await lstat(absolute)
      return info.isFile() ? info.size : 0
    }
    catch {
      return 0
    }
  }

  /**
   * 会话名（人看的那个「标题」）。
   *
   * 只读投影缓存：`record.rows.title.val` 是用户看到的名字（如「接入体重秤」）；
   * 没有标题时退回首条输入的前缀（`titleInput.val.first.text`），再没有就返回 undefined，
   * 由页面退化成显示 id —— 绝不为了"好看"去读会话日志（那是 zstd，且没必要为列表解压）。
   */
  const readSessionTitle = async (sessionId: string): Promise<string | undefined> => {
    try {
      const text = await readFile(projectionCachePath(roots.storages, sessionId), 'utf8')
      const rows = (JSON.parse(text) as any)?.record?.rows
      const title = rows?.title?.val
      if (typeof title === 'string' && title.trim() !== '')
        return title.trim()
      const first = rows?.titleInput?.val?.first?.text
      if (typeof first === 'string' && first.trim() !== '')
        return first.trim().slice(0, 80)
    }
    catch {
      /* 缓存缺失/损坏都只是"没有名字"，不影响删除逻辑 */
    }
    return undefined
  }

  /** 读目标会话引用到的附件 id；不完整时明确报告。 */
  const collectTargetReferences = async (sessionIds: string[]): Promise<{ complete: boolean, ids: Set<string>, reason?: string }> => {
    const events = query()?.listEvents
    if (typeof events !== 'function')
      return { complete: false, ids: new Set(), reason: 'query-unavailable' }
    const ids = new Set<string>()
    let count = 0
    const started = Date.now()
    for (const sessionId of sessionIds) {
      let rows
      try {
        rows = await events.call(query(), sessionId)
      }
      catch {
        return { complete: false, ids, reason: 'read-failed' }
      }
      const rowsArray = Array.isArray(rows) ? rows : []
      count += rowsArray.length
      if (count > TARGET_REFERENCE_BUDGET.events || Date.now() - started > TARGET_REFERENCE_BUDGET.milliseconds)
        return { complete: false, ids, reason: 'budget' }
      for (const id of extractAttachmentIds(rowsArray))
        ids.add(id)
    }
    return { complete: true, ids }
  }

  /** 定时任务按原会话 id 分组。 */
  const schedulesBySession = async (): Promise<Map<string, any[]>> => {
    const current = schedule()
    if (current === undefined || typeof current.catalog !== 'function')
      return new Map()
    const rows = await current.catalog()
    const map = new Map<string, any[]>()
    for (const row of Array.isArray(rows) ? rows : []) {
      const sessionId = String(row?.sessionId ?? '')
      if (sessionId === '')
        continue
      if (!map.has(sessionId))
        map.set(sessionId, [])
      map.get(sessionId)!.push(row)
    }
    return map
  }

  /** 投影缓存优先走 storageDomain 删，再按精确文件删（含备份尾巴）。 */
  const removeProjectionCache = async (sessionId: string): Promise<number> => {
    const file = projectionCachePath(roots.storages, sessionId)
    const freed = await fileSize(file)
    const domain = service('storageDomain')
    const table = domain?.get?.('session_projcache')?.table?.('sessions')
    if (table !== undefined && typeof table.delete === 'function') {
      try {
        await table.delete(sessionId)
      }
      catch (error) {
        warn(`[dsh-toolshed] projection cache record delete failed for ${sessionId}: ${String(error)}`)
      }
    }
    try {
      await rm(file, { force: true })
      const directory = projectionCacheDir(roots.storages)
      for (const name of await readdir(directory)) {
        if (!name.startsWith(`${sessionId}.json.`))
          continue
        const leftover = path.join(directory, name)
        await rm(leftover, { force: true })
      }
    }
    catch {
      /* 记录与备份都是 best-effort：domain 可能已经删掉了它们 */
    }
    return freed
  }

  /** 量一组会话的占用，不读事件日志。 */
  const measureGroup = async (group: string[]): Promise<{
    logBytes: number
    cacheBytes: number
    logFiles: number
    hasLog: boolean
    duplicate: boolean
    found: Map<string, string>
    duplicates: Set<string>
  }> => {
    const { found, duplicates } = await findSessionDirs(roots.sessions, group)
    let logBytes = 0
    let cacheBytes = 0
    let logFiles = 0
    let hasLog = false
    let duplicate = false
    for (const sessionId of group) {
      if (duplicates.has(sessionId)) {
        duplicate = true
        continue
      }
      const directory = found.get(sessionId)
      if (directory !== undefined) {
        hasLog = true
        const measured = await measureTree(directory)
        logBytes += measured.bytes
        logFiles += measured.files
      }
      cacheBytes += await fileSize(projectionCachePath(roots.storages, sessionId))
    }
    return { logBytes, cacheBytes, logFiles, hasLog, duplicate, found, duplicates }
  }

  /**
   * 丢弃「已不再归档」的队列条目。
   *
   * 取消归档即取消删除意图：会话重新可见后再删就违背了用户的最新动作。触发点有四个：
   * workspace 域变更、每次页面读取、Host 启动、以及本模块的 unarchive 路径。
   */
  const prunePending = (): Promise<{ removed: string[], kept: number }> => serialize(async () => {
    let queue: PendingEntry[]
    try {
      queue = await readQueue()
    }
    catch (error) {
      warn(`[dsh-toolshed] pending deletion queue is unreadable; prune skipped: ${error instanceof Error ? error.message : String(error)}`)
      return { removed: [], kept: 0 }
    }
    if (queue.length === 0)
      return { removed: [], kept: 0 }
    const archived = archivedSet()
    const kept = queue.filter(entry => archived.has(entry.id))
    const removed = queue.filter(entry => !archived.has(entry.id)).map(entry => entry.id)
    if (removed.length === 0)
      return { removed: [], kept: kept.length }
    try {
      await writeQueue(kept)
    }
    catch (error) {
      warn(`[dsh-toolshed] could not prune the pending deletion queue: ${error instanceof Error ? error.message : String(error)}`)
      return { removed: [], kept: kept.length }
    }
    return { removed, kept: kept.length }
  })

  /** 合并突发请求：一次工作区批量写入只跑一趟 prune。 */
  let pruneTimer: NodeJS.Timeout | null = null
  const schedulePrune = (): void => {
    if (pruneTimer !== null)
      return
    pruneTimer = setTimeout(() => {
      pruneTimer = null
      prunePending().catch((error) => {
        warn(`[dsh-toolshed] pending deletion prune failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 100)
    // 不要为了这一趟让 Host 进程（或测试运行器）活着。
    pruneTimer.unref?.()
  }

  /** 已归档会话清单（含精确磁盘占用）。 */
  const list = async (): Promise<ArchiveListResponse> => {
    // 在别处（原生菜单、另一个标签页）取消归档的会话即便 domain 事件还没到，也要撤掉它的待删除。
    schedulePrune()
    const ids = [...archivedSet()]
    const headers = await storedHeaders().catch(() => new Map<string, any>())
    const ownership = ownershipIndex()
    const queue = await readQueue().catch(() => [] as PendingEntry[])
    const pendingById = new Map(queue.map(entry => [entry.id, entry]))
    const inventory: ArchivedSessionView[] = []
    // 已排队删除的不再列出来（2.7.1：删除一律排队，列表里只留「还没被删的」）。
    const pendingIds: string[] = []
    for (const id of ids) {
      // 排队项只回 id：页面用它显示「N 条已排队 · 取消」，但不再把每一行渲染成带「待删除」徽标的行。
      if (pendingById.has(id)) {
        pendingIds.push(id)
        continue
      }
      const descendants = descendantsOf(id, headers)
      const measured = await measureGroup([id, ...descendants])
      // 2.7.2：日志目录已经不在的归档会话不再列出。
      // 用户删除是「当场删文件、留归档墓碑」，墓碑要等下次启动才清（清了侧栏就会冒出「未分类」空壳）；
      // 中间这段时间这一行若照旧显示，就成了一个点不开的「无日志」空壳。真正的墓碑清理由启动 sweep 做。
      if (!measured.hasLog)
        continue
      const workspace = ownership.get(id)
      inventory.push({
        id,
        title: await readSessionTitle(id),
        workspaceId: workspace === undefined ? undefined : String(workspace.id),
        workspaceTitle: workspace === undefined ? undefined : String(workspace.title),
        logBytes: measured.logBytes,
        cacheBytes: measured.cacheBytes,
        totalBytes: measured.logBytes + measured.cacheBytes,
        logFiles: measured.logFiles,
        hasLog: measured.hasLog,
        duplicate: measured.duplicate,
        live: liveSession(id) !== undefined,
        descendants,
      })
    }
    return {
      items: inventory,
      pendingIds,
      totals: {
        count: inventory.length,
        bytes: inventory.reduce((sum, item) => sum + item.totalBytes, 0),
        descendants: inventory.reduce((sum, item) => sum + item.descendants.length, 0),
        pending: pendingIds.length,
      },
      defaults: { cleanupAttachments: cleanupAttachmentsDefault },
      generatedAt: new Date().toISOString(),
    }
  }

  /** 删除的 dry-run 计划，供确认弹窗展示。 */
  const plan = async (ids: unknown, options: { cleanupAttachments?: boolean } = {}): Promise<ArchivePlanResponse> => {
    const unique = validateIds(ids)
    const cleanupAttachments = options.cleanupAttachments ?? cleanupAttachmentsDefault
    const archived = archivedSet()
    const headers = await storedHeaders().catch(() => new Map<string, any>())
    const queue = await readQueue().catch(() => [] as PendingEntry[])
    const pendingById = new Map(queue.map(entry => [entry.id, entry]))
    const items: ArchivePlanResponse['items'] = []
    for (const id of unique) {
      if (!archived.has(id)) {
        items.push({ id, ok: false, code: 'not-archived', message: 'session is not archived' })
        continue
      }
      const descendants = descendantsOf(id, headers)
      const liveDescendant = descendants.find(sessionId => liveSession(sessionId) !== undefined)
      const measured = await measureGroup([id, ...descendants])
      const pendingEntry = pendingById.get(id)
      const live = liveSession(id) !== undefined
      items.push({
        id,
        title: await readSessionTitle(id),
        ok: true,
        descendants,
        live,
        pending: pendingEntry === undefined ? undefined : pendingView(pendingEntry),
        // 只有「内存里还活着」的才排队；其余当场删（2.7.2 定稿）。
        willQueue: pendingEntry === undefined && (live || liveDescendant !== undefined),
        liveDescendant,
        logBytes: measured.logBytes,
        cacheBytes: measured.cacheBytes,
        totalBytes: measured.logBytes + measured.cacheBytes,
        logFiles: measured.logFiles,
        hasLog: measured.hasLog,
        duplicate: measured.duplicate,
      })
    }
    const okItems = items.filter(item => item.ok)
    const immediate = okItems.filter(item => item.pending === undefined && item.willQueue !== true)
    const queued = okItems.filter(item => item.pending !== undefined || item.willQueue === true)
    const totalOf = (item: (typeof okItems)[number]): number => item.totalBytes ?? 0
    return {
      items,
      totals: {
        count: okItems.length,
        bytes: okItems.reduce((sum, item) => sum + totalOf(item), 0),
        immediateBytes: immediate.reduce((sum, item) => sum + totalOf(item), 0),
        queuedBytes: queued.reduce((sum, item) => sum + totalOf(item), 0),
        descendants: okItems.reduce((sum, item) => sum + (item.descendants?.length ?? 0), 0),
        immediate: immediate.length,
        queued: queued.length,
      },
      cleanupAttachments,
      generatedAt: new Date().toISOString(),
    }
  }

  /** 真正的删除实现（调用方已持锁）。 */
  const removeUnlocked = async (
    ids: unknown,
    options: { cleanupAttachments?: boolean, queueLive?: boolean, ignoreQueue?: boolean, unarchiveOnDelete?: boolean } = {},
  ): Promise<ArchiveRemoveResponse> => {
    const unique = validateIds(ids)
    const cleanupAttachments = options.cleanupAttachments ?? cleanupAttachmentsDefault
    const queueLive = options.queueLive !== false
    const ignoreQueue = options.ignoreQueue === true
    const archived = archivedSet()
    const headers = await storedHeaders().catch(() => new Map<string, any>())
    const ownership = ownershipIndex()
    const schedules = await schedulesBySession().catch(() => new Map<string, any[]>())
    let queue: PendingEntry[] = []
    let queueReadError: unknown = null
    if (!ignoreQueue) {
      try {
        queue = await readQueue()
      }
      catch (error) {
        queueReadError = error
        warn(`[dsh-toolshed] pending deletion queue is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const queuedIds = new Set(queue.map(entry => entry.id))
    const queueAdditions: string[] = []
    const results: ArchiveRemoveItemView[] = []
    const deletedIds = new Set<string>()
    const candidates = new Set<string>()
    let attachmentScanAvailable = cleanupAttachments && typeof query()?.listEvents === 'function'

    for (const id of unique) {
      if (!archived.has(id)) {
        results.push({ id, deleted: false, code: 'not-archived', message: 'session is not archived', warnings: [] })
        continue
      }
      if (!ignoreQueue && queuedIds.has(id)) {
        results.push({ id, deleted: false, queued: true, alreadyQueued: true, freedBytes: 0, warnings: [] })
        continue
      }
      if (liveSession(id) !== undefined) {
        if (queueLive) {
          queuedIds.add(id)
          queueAdditions.push(id)
          results.push({ id, deleted: false, queued: true, freedBytes: 0, warnings: [] })
          continue
        }
        results.push({ id, deleted: false, code: 'live-session', message: 'session is live in memory; it cannot be deleted now', warnings: [] })
        continue
      }
      const descendants = descendantsOf(id, headers)
      const group = [id, ...descendants]
      const liveDescendant = group.find(sessionId => liveSession(sessionId) !== undefined)
      if (liveDescendant !== undefined) {
        if (queueLive) {
          queuedIds.add(id)
          queueAdditions.push(id)
          results.push({ id, deleted: false, queued: true, freedBytes: 0, warnings: [] })
          continue
        }
        results.push({ id, deleted: false, code: 'live-descendant', message: `descendant ${liveDescendant} is live`, warnings: [] })
        continue
      }

      let groupCandidates: Set<string> | null = null
      if (attachmentScanAvailable) {
        const referenced = await collectTargetReferences(group)
        if (referenced.complete)
          groupCandidates = referenced.ids
        else
          attachmentScanAvailable = false
      }

      const warnings: string[] = []
      let freedBytes = 0
      let failed = false

      // 先停掉仍在跑的派生会话，再去碰它们的日志。
      const quiesced: string[] = []
      for (const sessionId of descendants) {
        try {
          await requireRegistry().archiveSession(sessionId, { stopActivity: true })
          quiesced.push(sessionId)
        }
        catch (error) {
          warnings.push(`could not stop descendant ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const { found, duplicates } = await findSessionDirs(roots.sessions, group)
      for (const sessionId of group) {
        if (duplicates.has(sessionId)) {
          failed = true
          warnings.push(`duplicate log directory for ${sessionId}; not deleting`)
          continue
        }
        const directory = found.get(sessionId)
        if (directory === undefined)
          continue
        if (!isInside(roots.sessions, directory)) {
          failed = true
          warnings.push(`refused a log directory outside the sessions root for ${sessionId}`)
          continue
        }
        try {
          const measured = await measureTree(directory)
          await removeTree(directory)
          freedBytes += measured.bytes
        }
        catch (error) {
          failed = true
          warnings.push(`log directory delete failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (failed) {
        // 把为后代改过的归档状态还原；父会话保持归档，方便重试。
        for (const sessionId of quiesced) {
          try {
            await requireRegistry().unarchiveSession(sessionId)
          }
          catch {}
        }
        results.push({ id, deleted: false, code: 'log-delete-failed', message: 'could not delete the session log directory', warnings })
        continue
      }

      // 绑定到这一组的定时任务会继续往已删会话投递，必须一起删。
      let schedulesDeleted = 0
      for (const sessionId of group) {
        for (const task of schedules.get(sessionId) ?? []) {
          try {
            await schedule().delete({ sessionId, id: task.id })
            schedulesDeleted += 1
          }
          catch (error) {
            warnings.push(`schedule ${String(task.id)} delete failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }

      for (const sessionId of group) {
        try {
          freedBytes += await removeProjectionCache(sessionId)
        }
        catch (error) {
          warnings.push(`projection cache delete failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      for (const sessionId of group) {
        try {
          ownership.get(sessionId)?.detachSession?.(sessionId)
        }
        catch {
          /* 内部 helper：槽位会在下次注册表写入或重启后自行修剪 */
        }
        try {
          // 不同核心代把 detach 挂在工作区视图或注册表本身上，两处都试一次（都是可选调用）。
          registry()?.detachSession?.(sessionId)
        }
        catch {
          /* 同上 */
        }
        try {
          await requireRegistry().unpinSession(sessionId)
        }
        catch {
          /* 置顶与归档互斥；这里只是一致性兜底 */
        }
        // 2.7.2 起**不在删除时清归档墓碑**：宿主内存里还记着这条会话，墓碑一清侧栏就会把它渲染成
        // 「未分类」空壳（用户实测过）。文件已经删了，墓碑等下次启动的 sweep 统一清（见 `sweepPending`
        // 的孤儿墓碑处理）——那时注册表从磁盘重建，对外不可见的中间态才不会泄漏到界面上。
        if (options.unarchiveOnDelete !== false) {
          try {
            await requireRegistry().unarchiveSession(sessionId)
          }
          catch (error) {
            warnings.push(`archive record cleanup failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        deletedIds.add(sessionId)
      }

      if (groupCandidates !== null) {
        for (const candidate of groupCandidates)
          candidates.add(candidate)
      }
      results.push({ id, deleted: true, freedBytes, descendants: descendants.length, schedulesDeleted, warnings })
    }

    // 整批结束后再落盘队列：队列写失败要作为结果报出来，而不是静默丢掉删除意图。
    let queueWriteError: unknown = null
    if (queueAdditions.length > 0) {
      if (queueReadError !== null) {
        queueWriteError = queueReadError
      }
      else {
        const known = new Set(queue.map(entry => entry.id))
        for (const id of queueAdditions) {
          if (!known.has(id))
            queue.push(createPendingEntry(id, cleanupAttachments))
        }
        if (queue.length > PENDING_MAX) {
          queueWriteError = new Error(`pending deletion queue exceeds ${PENDING_MAX} entries`)
        }
        else {
          try {
            await writeQueue(queue)
          }
          catch (error) {
            queueWriteError = error
          }
        }
      }
    }
    if (queueWriteError !== null) {
      const message = `could not persist the pending deletion: ${queueWriteError instanceof Error ? queueWriteError.message : String(queueWriteError)}`
      for (const result of results) {
        if (result.queued === true && result.alreadyQueued !== true) {
          result.queued = false
          result.deleted = false
          result.code = 'queue-failed'
          result.message = message
        }
      }
    }

    let attachment: ArchiveAttachmentOutcome = { freedBytes: 0, deleted: 0, skipped: 'disabled' }
    if (cleanupAttachments) {
      if (!attachmentScanAvailable) {
        attachment = { freedBytes: 0, deleted: 0, skipped: 'reference-scan-unavailable' }
      }
      else if (candidates.size === 0) {
        attachment = { freedBytes: 0, deleted: 0, skipped: 'no-candidates' }
      }
      else {
        const headersAfter = await storedHeaders().catch(() => null)
        if (headersAfter === null) {
          attachment = { freedBytes: 0, deleted: 0, skipped: 'listing-failed' }
        }
        else {
          const remaining = [...headersAfter.keys()].filter(sessionId => !deletedIds.has(sessionId))
          const scan = await scanAttachmentReferences({
            sessionIds: remaining,
            // 与 collectTargetReferences 一样显式绑定 this：服务方法可能依赖实例字段，
            // 裸调用会让整轮扫描以 read-failed 收场、附件清理静默禁用。
            readEvents: (sessionId: string) => query().listEvents.call(query(), sessionId),
            uploadIndexPath: roots.uploadIndex,
            budget: REFERENCE_BUDGET,
          })
          if (!scan.complete) {
            attachment = { freedBytes: 0, deleted: 0, skipped: scan.reason ?? 'reference-scan-incomplete' }
          }
          else {
            const pruned = await pruneUnreferencedAttachments({
              attachmentsRoot: roots.attachments,
              candidates,
              referenced: scan.referenced,
            })
            attachment = {
              freedBytes: pruned.freedBytes,
              deleted: pruned.deleted.length,
              failed: pruned.failed,
              skipped: undefined,
            }
          }
        }
      }
    }

    const freedBytes = results.reduce((sum, item) => sum + (item.deleted ? (item.freedBytes ?? 0) : 0), 0) + attachment.freedBytes
    return {
      results,
      attachment,
      totals: {
        requested: unique.length,
        deleted: results.filter(item => item.deleted).length,
        queued: results.filter(item => item.queued === true).length,
        failed: results.filter(item => item.deleted !== true && item.queued !== true).length,
        freedBytes,
      },
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * 删除入口：非 live 的**当场删文件**，live 的排队到下次启动。
   *
   * 归档墓碑**不当场清**（`unarchiveOnDelete: false`）：清了宿主内存里那条会话就会以「未分类」形态
   * 冒到原生侧栏；留到下次启动由 sweep 统一清（那时注册表从磁盘重建，中间态不会泄漏）。
   */
  const remove = (ids: unknown, options: { cleanupAttachments?: boolean } = {}): Promise<ArchiveRemoveResponse> =>
    serialize(() => removeUnlocked(ids, { ...options, unarchiveOnDelete: false }))

  /** 撤销排队中的删除。此刻磁盘上什么都没动，取消是即时且不可能丢数据的。 */
  const cancelPending = (ids: unknown): Promise<ArchiveCancelResponse> => serialize(async () => {
    const unique = validateIds(ids)
    let queue: PendingEntry[]
    try {
      queue = await readQueue()
    }
    catch (error) {
      throw new ArchiveRequestError('queue-unavailable', `pending deletion queue is unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
    const wanted = new Set(unique)
    const removed = new Set<string>()
    const kept: PendingEntry[] = []
    for (const entry of queue) {
      if (wanted.has(entry.id))
        removed.add(entry.id)
      else
        kept.push(entry)
    }
    if (removed.size > 0) {
      try {
        await writeQueue(kept)
      }
      catch (error) {
        throw new ArchiveRequestError('queue-write-failed', `could not persist the pending queue: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      results: unique.map(id => ({ id, cancelled: removed.has(id) })),
      totals: { requested: unique.length, cancelled: removed.size },
      generatedAt: new Date().toISOString(),
    }
  })

  /**
   * 清「孤儿归档墓碑」：日志目录已经不存在的归档会话。
   *
   * 为什么需要它：2.7.2 起用户删除**当场删文件、留墓碑**（清了墓碑，宿主内存里那条会话就会以
   * 「未分类」形态冒到原生侧栏），墓碑只能等下次启动清。这里只处理「目录确实不存在、且不在跑」的；
   * `sessions` 根读不出来时整段跳过——不要凭一次失败就丢掉归档标记。
   */
  const cleanOrphanTombstones = async (skipIds: ReadonlySet<string>): Promise<string[]> => {
    const orphans: string[] = []
    try {
      const candidates = [...archivedSet()].filter(id => !skipIds.has(id))
      if (candidates.length === 0)
        return orphans
      const { found } = await findSessionDirs(roots.sessions, candidates)
      for (const id of candidates) {
        if (found.has(id) || liveSession(id) !== undefined)
          continue
        try {
          ownershipIndex().get(id)?.detachSession?.(id)
        }
        catch {}
        try {
          registry()?.detachSession?.(id)
        }
        catch {}
        try {
          await requireRegistry().unpinSession(id)
        }
        catch {}
        try {
          await requireRegistry().unarchiveSession(id)
          orphans.push(id)
        }
        catch {}
      }
    }
    catch (error) {
      warn(`[dsh-toolshed] orphan archive cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    return orphans
  }

  /**
   * Host 启动时执行队列（那时没有 live 会话）。
   *
   * 每条都重新校验：取消归档的丢掉意图，仍 live 的留到下次启动，删除失败保留原因供页面显示。
   */
  const sweepPending = (): Promise<ArchiveSweepResponse> => serialize(async () => {
    let queue: PendingEntry[]
    try {
      queue = await readQueue()
    }
    catch (error) {
      warn(`[dsh-toolshed] pending deletion queue is unreadable; sweep skipped: ${error instanceof Error ? error.message : String(error)}`)
      return {
        results: { deleted: [], failed: [], dropped: [], kept: [] },
        totals: { queued: 0, deleted: 0, kept: 0, dropped: 0, freedBytes: 0 },
        error: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString(),
      }
    }
    if (queue.length === 0) {
      // 队列空也要跑一遍孤儿墓碑清理：它清的是「上次启动删掉文件时留下的墓碑」，与队列无关。
      const orphans = await cleanOrphanTombstones(new Set())
      return {
        results: { deleted: [], failed: [], dropped: [], kept: [], orphans },
        totals: { queued: 0, deleted: 0, kept: 0, dropped: 0, freedBytes: 0 },
        generatedAt: new Date().toISOString(),
      }
    }
    const archived = archivedSet()
    const headers = await storedHeaders().catch(() => new Map<string, any>())
    const keep: PendingEntry[] = []
    const dropped: Array<{ id: string, reason: string }> = []
    const batches = new Map<string, PendingEntry[]>()
    for (const entry of queue) {
      if (!archived.has(entry.id)) {
        dropped.push({ id: entry.id, reason: 'not-archived' })
        continue
      }
      const descendants = descendantsOf(entry.id, headers)
      const live = [entry.id, ...descendants].some(sessionId => liveSession(sessionId) !== undefined)
      if (live) {
        keep.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: 'session-live',
          lastAttemptAt: new Date().toISOString(),
        })
        continue
      }
      const key = entry.cleanupAttachments === false ? 'false' : 'true'
      if (!batches.has(key))
        batches.set(key, [])
      batches.get(key)!.push(entry)
    }
    const deleted: Array<{ id: string, freedBytes?: number }> = []
    const failed: Array<{ id: string, code: string }> = []
    for (const [flag, entries] of batches) {
      let outcome: ArchiveRemoveResponse
      try {
        outcome = await removeUnlocked(entries.map(entry => entry.id), {
          cleanupAttachments: flag === 'true',
          queueLive: false,
          ignoreQueue: true,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const entry of entries) {
          keep.push({ ...entry, attempts: entry.attempts + 1, lastError: message, lastAttemptAt: new Date().toISOString() })
          failed.push({ id: entry.id, code: 'delete-failed' })
        }
        continue
      }
      for (const entry of entries) {
        const result = outcome.results.find(item => item.id === entry.id)
        if (result?.deleted === true) {
          deleted.push({ id: entry.id, freedBytes: result.freedBytes })
          continue
        }
        if (result?.code === 'not-archived') {
          dropped.push({ id: entry.id, reason: 'not-archived' })
          continue
        }
        keep.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: result?.code ?? 'delete-failed',
          lastAttemptAt: new Date().toISOString(),
        })
        failed.push({ id: entry.id, code: result?.code ?? 'delete-failed' })
      }
    }
    try {
      await writeQueue(keep)
    }
    catch (error) {
      warn(`[dsh-toolshed] could not rewrite the pending deletion queue: ${error instanceof Error ? error.message : String(error)}`)
    }
    // 孤儿墓碑：本地删过文件的会话，归档标记留到了这次启动才清（2.7.2 的删除不再当场清墓碑，
    // 否则宿主内存里那条会话会以「未分类」形态冒到原生侧栏）。
    const orphans = await cleanOrphanTombstones(new Set([...keep.map(entry => entry.id), ...deleted.map(item => item.id)]))
    return {
      results: { deleted, failed, dropped, kept: keep.map(entry => entry.id), orphans },
      totals: {
        queued: queue.length,
        deleted: deleted.length,
        kept: keep.length,
        dropped: dropped.length,
        freedBytes: deleted.reduce((sum, item) => sum + (item.freedBytes ?? 0), 0),
      },
      generatedAt: new Date().toISOString(),
    }
  })

  /** 不打开会话就取消归档。 */
  const unarchive = (ids: unknown): Promise<ArchiveUnarchiveResponse> => serialize(async () => {
    const unique = validateIds(ids)
    const registryValue = requireRegistry()
    const archived = archivedSet()
    const results: Array<{ id: string, unarchived: boolean, code?: string, message?: string }> = []
    for (const id of unique) {
      if (!archived.has(id)) {
        results.push({ id, unarchived: false, code: 'not-archived', message: 'session is not archived' })
        continue
      }
      try {
        await registryValue.unarchiveSession(id)
        results.push({ id, unarchived: true })
      }
      catch (error) {
        results.push({ id, unarchived: false, code: 'unarchive-failed', message: error instanceof Error ? error.message : String(error) })
      }
    }
    // 取消归档同时清掉同一会话的待删除意图。
    const unarchivedIds = new Set(results.filter(item => item.unarchived).map(item => item.id))
    if (unarchivedIds.size > 0) {
      try {
        const queue = await readQueue()
        const kept = queue.filter(entry => !unarchivedIds.has(entry.id))
        if (kept.length !== queue.length)
          await writeQueue(kept)
      }
      catch (error) {
        warn(`[dsh-toolshed] could not clear pending deletions after unarchive: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      results,
      totals: { requested: unique.length, unarchived: results.filter(item => item.unarchived).length },
      generatedAt: new Date().toISOString(),
    }
  })

  return { list, plan, remove, unarchive, cancelPending, sweepPending, prunePending, schedulePrune, roots }
}
