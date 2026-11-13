/**
 * 已归档会话管理的线协议与视图类型（客户端经 `apis/index.type.ts` 再导出，宿主是唯一权威）。
 */

/** 队列条目在页面上的形状。 */
export interface ArchivedPendingView {
  requestedAt: string
  cleanupAttachments: boolean
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
}

/** 列表里的一行。 */
export interface ArchivedSessionView {
  id: string
  workspaceId?: string
  workspaceTitle?: string
  logBytes: number
  cacheBytes: number
  totalBytes: number
  logFiles: number
  hasLog: boolean
  duplicate: boolean
  live: boolean
  descendants: string[]
  pending?: ArchivedPendingView
}

export interface ArchivedListTotals {
  count: number
  bytes: number
  descendants: number
  pending: number
}

/** GET /api/archived */
export interface ArchiveListResponse {
  items: ArchivedSessionView[]
  totals: ArchivedListTotals
  defaults: { cleanupAttachments: boolean }
  generatedAt: string
}

/** 计划里的一行：`ok:false` 表示这条不会被删（附原因码）。 */
export interface ArchivePlanItemView {
  id: string
  ok: boolean
  code?: string
  message?: string
  descendants?: string[]
  live?: boolean
  pending?: ArchivedPendingView
  willQueue?: boolean
  liveDescendant?: string
  logBytes?: number
  cacheBytes?: number
  totalBytes?: number
  logFiles?: number
  hasLog?: boolean
  duplicate?: boolean
}

export interface ArchivePlanTotals {
  count: number
  bytes: number
  immediateBytes: number
  queuedBytes: number
  descendants: number
  immediate: number
  queued: number
}

/** POST /api/archive/plan */
export interface ArchivePlanResponse {
  items: ArchivePlanItemView[]
  totals: ArchivePlanTotals
  cleanupAttachments: boolean
  generatedAt: string
}

/** 删除结果的一行。 */
export interface ArchiveRemoveItemView {
  id: string
  deleted: boolean
  queued?: boolean
  alreadyQueued?: boolean
  freedBytes?: number
  descendants?: number
  schedulesDeleted?: number
  warnings: string[]
  code?: string
  message?: string
}

export interface ArchiveAttachmentOutcome {
  freedBytes: number
  deleted: number
  failed?: Array<{ id: string, message: string }>
  skipped?: string
}

/** DELETE /api/archive */
export interface ArchiveRemoveResponse {
  results: ArchiveRemoveItemView[]
  attachment: ArchiveAttachmentOutcome
  totals: { requested: number, deleted: number, queued: number, failed: number, freedBytes: number }
  generatedAt: string
}

/** POST /api/archive/pending/cancel */
export interface ArchiveCancelResponse {
  results: Array<{ id: string, cancelled: boolean }>
  totals: { requested: number, cancelled: number }
  generatedAt: string
}

/** POST /api/archive/unarchive */
export interface ArchiveUnarchiveResponse {
  results: Array<{ id: string, unarchived: boolean, code?: string, message?: string }>
  totals: { requested: number, unarchived: number }
  generatedAt: string
}

/** 宿主启动清扫的摘要（仅日志用）。 */
export interface ArchiveSweepResponse {
  results: { deleted: Array<{ id: string, freedBytes?: number }>, failed: Array<{ id: string, code: string }>, dropped: Array<{ id: string, reason: string }>, kept: string[] }
  totals: { queued: number, deleted: number, kept: number, dropped: number, freedBytes: number }
  error?: string
  generatedAt: string
}

/** 请求体。 */
export interface ArchivePlanBody {
  ids: string[]
  cleanupAttachments?: boolean
}

export interface ArchiveDeleteBody {
  ids: string[]
  cleanupAttachments?: boolean
}

export interface ArchiveCancelBody {
  ids: string[]
}

/** 重启相关。 */
export interface RestartBlockerView {
  id: string
  kind: 'running' | 'queued' | 'job'
}

/** GET /api/host/restart */
export interface RestartStatusResponse {
  canRestart: boolean
  restartAvailable: boolean
  blockers: RestartBlockerView[]
  reason?: string
  logFile?: string
}

/** POST /api/host/restart */
export interface RestartLaunchResponse {
  ok: boolean
  parentPid: number
  planFile: string
  logFile: string
}
