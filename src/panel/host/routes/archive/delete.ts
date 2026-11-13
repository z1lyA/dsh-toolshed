import type { EventHandlerRequest } from 'dsh-tauri'
import type { ArchiveDeleteBody, ArchiveRemoveResponse, ExtensionRouteDeps } from '../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../failure'

/**
 * DELETE /api/archive — 永久删除已归档会话。
 *
 * 破坏性动作用 DELETE（与 `/api/mcp`、`/api/skill` 的写法一致）。仍在内存里活着的会话不会
 * 被强删，而是登记到待删除队列、下次启动执行——这是宿主持有 Agent 句柄时的硬约束。
 */
export default defineEventHandler<EventHandlerRequest, Promise<ArchiveRemoveResponse | { error: string, code: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<ArchiveDeleteBody>(event, { type: 'json' })
  if (body === undefined || !Array.isArray(body.ids)) {
    event.res.status = 400
    return { error: 'ids must be an array', code: 'invalid-request' }
  }
  try {
    return await deps.archive.remove(body.ids, { cleanupAttachments: body.cleanupAttachments })
  }
  catch (error) {
    return failure(event, error)
  }
})
