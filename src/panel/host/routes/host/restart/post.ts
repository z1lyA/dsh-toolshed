import type { RestartLaunchResponse, ExtensionRouteDeps } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/host/restart — 进程级重启桌面应用。
 *
 * 这一层比 `defineRoutes` 内建的闸门更严：要求 Origin 与 Host 同源，并拒绝任何带
 * `forwarded` / `x-forwarded-for` / `x-real-ip` 的请求——重启是不可撤销动作，反代链不认。
 */
export default defineEventHandler(async (event): Promise<RestartLaunchResponse | { error: string, code?: string }> => {
  const headers = event.req.headers
  const origin = headers.get('origin')
  const host = headers.get('host')
  let sameOrigin = false
  if (origin !== null && host !== null) {
    try {
      const parsed = new URL(origin)
      sameOrigin = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
    }
    catch {
      sameOrigin = false
    }
  }
  const forwarded = headers.has('forwarded') || headers.has('x-forwarded-for') || headers.has('x-real-ip')
  if (!sameOrigin || forwarded) {
    event.res.status = 403
    return { error: 'untrusted origin', code: 'forbidden' }
  }
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  try {
    return await deps.restart.execute()
  }
  catch (error) {
    return failure(event, error)
  }
})
