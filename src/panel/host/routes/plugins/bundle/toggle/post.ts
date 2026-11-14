import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginBundleToggleBody, PluginToggleResponse } from '../../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../../failure'

/**
 * POST /api/plugins/bundle/toggle — 启用/停用一整个 npm 包（profile 的 `dsh.profile.bundles` 组合）。
 *
 * 独立成路径而不是复用 `/plugins/toggle`：两者的定位键不同（包名 vs `entryId`），混在一个 body
 * 里就会靠字段是否存在来分支，而 400 的口径也跟着含糊。
 *
 * 与行级同口径：官方 `application:'failed'` 照样是 200（业务结论，页面靠 `errorCode` / `diagnostic`
 * 如实说明并给撤销入口）；只有「停用 dsh-toolshed 自己」是 409，服务缺失是 503。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginToggleResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginBundleToggleBody>(event, { type: 'json' })
  if (typeof body?.name !== 'string' || body.name === '' || typeof body.enabled !== 'boolean') {
    event.res.status = 400
    return { error: 'name and enabled are required' }
  }
  try {
    return await deps.plugins.toggleBundle({ name: body.name, enabled: body.enabled })
  }
  catch (error) {
    return failure(event, error)
  }
})
