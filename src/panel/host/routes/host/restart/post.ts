import type { RestartLaunchResponse, ExtensionRouteDeps } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/host/restart — 进程级重启桌面应用。
 *
 * 信任边界交给 `defineRoutes` 的内建闸门：变更方法仅本机回环、`Origin` 与 `Host` 不符即 403、
 * `connection.requestRejection` 做浏览器认证——和 `DELETE /api/archive` 这类破坏性路由同一套。
 *
 * 为什么删掉了 1.x 里那段手写的「Origin 必须同源 + 拒绝 forwarded 头」检查（2.0.1）：
 * 桌面壳的请求是经内部代理转发的，可能**不带 Origin**、或带 `x-forwarded-for`，于是每次点重启
 * 都被判 `403 untrusted origin`——用户只看到一句看不懂的英文，按钮等于永远不可用。
 * 那段判据挡住的正是合法请求，而框架闸门已经覆盖同样的攻击面。
 */
export default defineEventHandler(async (event): Promise<RestartLaunchResponse | { error: string, code?: string }> => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  try {
    return await deps.restart.execute()
  }
  catch (error) {
    return failure(event, error)
  }
})
