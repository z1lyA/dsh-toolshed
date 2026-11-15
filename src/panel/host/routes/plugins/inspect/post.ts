import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginInspectBody, PluginInspectResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * spec 长度上限 512。
 *
 * 包名 / `@version` / git 地址 / 本地路径都远达不到这个长度；超过了基本是误把整篇 README
 * 或半页 JSON 粘进来——在打给 pnpm 之前挡下来，比让官方跑一次 `pnpm view` 再失败更省时间。
 */
const SPEC_MAX_LENGTH = 512

/**
 * POST /api/plugins/inspect — 安装前检查（官方 `pluginManager.inspect()` 的投影）。
 *
 * 检查**不装任何东西**：它只是问注册表 / 读 manifest / 认一下 spec 的形式。所以拒绝是 200 +
 * `status:'refused'`（业务结论，页面要显示官方的原话），只有请求本身不合法才是 400，
 * 服务缺失是 503。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginInspectResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginInspectBody>(event, { type: 'json' })
  const spec = typeof body?.spec === 'string' ? body.spec.trim() : ''
  if (spec === '' || spec.length > SPEC_MAX_LENGTH) {
    event.res.status = 400
    return { error: 'spec is required' }
  }
  try {
    return await deps.plugins.inspect({ spec })
  }
  catch (error) {
    return failure(event, error)
  }
})
