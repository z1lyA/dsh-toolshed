import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginRemoveBody, PluginRemoveResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/plugins/remove —— 卸载一个包（走官方 `pluginManager.removeBundle`）。
 *
 * 与启停 / 安装 / 更新一样只做参数校验与投影：真正「取消选中 → pnpm remove → reload」都交给官方，
 * 它拒绝时可识别的机器码（`not-removable` / `stop-profile` / `bundle-in-use`）原样回给页面。
 * 「卸载 dsh-toolshed 自己」在服务层硬拒绝（409 `self-management`）。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginRemoveResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginRemoveBody>(event, { type: 'json' })
  if (typeof body?.name !== 'string' || body.name === '' || body.name.length > 200) {
    event.res.status = 400
    return { error: 'name is required' }
  }
  try {
    return await deps.plugins.remove({ name: body.name })
  }
  catch (error) {
    return failure(event, error)
  }
})
