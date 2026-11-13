import type { EventHandlerRequest } from 'dsh-tauri'
import type { ArchiveCancelBody, ArchiveUnarchiveResponse, ExtensionRouteDeps } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/archive/unarchive — 批量取消归档。
 *
 * 为什么走 host 而不是页面直接调 `ctx.workspaces.unarchiveSession`：tab 组件只拿到 `t`
 * （与 skills/mcp 两个 tab 一致，没有 adapter），而 page 的本地信任边界与错误映射
 * 已经在这里了；顺带保证「取消归档同时清掉待删除意图」在 host 侧原子发生。
 */
export default defineEventHandler<EventHandlerRequest, Promise<ArchiveUnarchiveResponse | { error: string, code: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<ArchiveCancelBody>(event, { type: 'json' })
  if (body === undefined || !Array.isArray(body.ids)) {
    event.res.status = 400
    return { error: 'ids must be an array', code: 'invalid-request' }
  }
  try {
    return await deps.archive.unarchive(body.ids)
  }
  catch (error) {
    return failure(event, error)
  }
})
