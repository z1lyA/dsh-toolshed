import type { ExtensionRouteDeps, RestartStatusResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * GET /api/host/restart — 「服务」页的状态探测。
 *
 * 只读：告诉页面能不能重启、被哪些工作挡住、日志落在哪。同一 path 上再加一个 GET 不会
 * 增加 `webServer.register` 的行数（defineRoutes 按 `(kind, path)` 收敛）。
 */
export default defineEventHandler((event): RestartStatusResponse | { error: string, code: string } => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  try {
    return deps.restart.check()
  }
  catch (error) {
    return failure(event, error)
  }
})
