import type { ExtensionRouteDeps, PluginsListResponse } from '../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../failure'

/**
 * GET /api/plugins — 「包 + 条目」双清单（官方 `pluginManager.listBundles()` / `listPlugins()` 的投影）。
 *
 * 为什么两个都给：包是页面主视图（图标 + 名称 + 一句话），扁平条目只用来计数与搜索——
 * 本机 227 条里绝大多数是 DSH 自己的内部模块，铺开给人看没法用。
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
