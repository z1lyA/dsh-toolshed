import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginToggleBody, PluginToggleResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/plugins/toggle — 启用/停用一行插件。
 *
 * 官方 `application:'failed'` 照样是 200：那是业务结论（前置校验拒绝，或「文件写了但没生效」），
 * 页面要靠 `errorCode` / `diagnostic` 如实说明并给撤销入口。只有意外异常才走 5xx。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginToggleResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginToggleBody>(event, { type: 'json' })
  if (typeof body?.entryId !== 'string' || body.entryId === '' || typeof body.enabled !== 'boolean') {
    event.res.status = 400
    return { error: 'entryId and enabled are required' }
  }
  try {
    return await deps.plugins.toggle({ entryId: body.entryId, enabled: body.enabled })
  }
  catch (error) {
    return failure(event, error)
  }
})
