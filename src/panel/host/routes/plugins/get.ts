import type { ExtensionRouteDeps, PluginsListResponse } from '../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../failure'

/**
 * GET /api/plugins — 运行中的插件清单（官方 `pluginManager.listPlugins()` 的投影）。
 *
 * 服务缺失时回 503 + `plugin-manager-unavailable`，而不是 200 + 空列表：后者会让页面显示
 * 「一个插件都没装」，把「当前 DSH 版本不支持插件管理」误导成用户配置为空。
 */
export default defineEventHandler(async (event): Promise<PluginsListResponse | { error: string, code: string }> => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  try {
    return await deps.plugins.list()
  }
  catch (error) {
    return failure(event, error)
  }
})
