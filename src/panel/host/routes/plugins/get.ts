import type { ExtensionRouteDeps, PluginsListResponse } from '../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../failure'

/**
 * GET /api/plugins — npm 包清单（官方 `pluginManager.listBundles()` 的投影）。
 *
 * 只有包、没有 Loader 条目：官方的 `listPlugins()` 在本机有 227 条，绝大多数是 DSH 自己的内部模块，
 * 铺开给人看没法用；条目级开关交给官方「插件」页。响应里因此既没有 `plugins` 也没有 `rows`。
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
