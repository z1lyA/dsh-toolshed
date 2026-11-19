import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginUpdateCheckBody, PluginUpdateCheckResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/plugins/updates —— 批量检查这些包有没有更新（只查，不改任何文件）。
 *
 * 为什么一次收一批而不是一个包一个路由：客户端是「进页面查一次」，逐个来回 N 次只会更慢；
 * 串行与「单个失败不中断整批」都在服务层做（见 `checkUpdates`）。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginUpdateCheckResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginUpdateCheckBody>(event, { type: 'json' })
  if (!Array.isArray(body?.names) || body.names.length === 0 || body.names.length > 64) {
    event.res.status = 400
    return { error: 'names must be a non-empty array of at most 64 package names' }
  }
  const names = body.names.filter(name => typeof name === 'string' && name !== '' && name.length <= 200)
  if (names.length !== body.names.length) {
    event.res.status = 400
    return { error: 'every name must be a non-empty string of at most 200 characters' }
  }
  try {
    return await deps.plugins.checkUpdates({ names })
  }
  catch (error) {
    return failure(event, error)
  }
})
