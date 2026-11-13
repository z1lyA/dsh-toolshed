import type { EventHandlerRequest } from 'dsh-tauri'
import type { ArchivePlanBody, ArchivePlanResponse, ExtensionRouteDeps } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/archive/plan — 删除前的一次 dry-run。
 *
 * 单独一个端点而不是 `?dryRun=1`：确认弹窗要拿「立即删 / 排队 / 拒绝」的分类与体积，
 * 这是读操作，不该和破坏性的 DELETE 共用一条路径（也不影响 defineRoutes 的路径计数）。
 */
export default defineEventHandler<EventHandlerRequest, Promise<ArchivePlanResponse | { error: string, code: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<ArchivePlanBody>(event, { type: 'json' })
  if (body === undefined || !Array.isArray(body.ids)) {
    event.res.status = 400
    return { error: 'ids must be an array', code: 'invalid-request' }
  }
  try {
    return await deps.archive.plan(body.ids, { cleanupAttachments: body.cleanupAttachments })
  }
  catch (error) {
    return failure(event, error)
  }
})
