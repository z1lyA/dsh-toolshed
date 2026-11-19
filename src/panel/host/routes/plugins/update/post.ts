import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginUpdateBody, PluginUpdateResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/**
 * POST /api/plugins/update —— 把一个包更新到检查时给出的版本。
 *
 * 必须带上检查时看到的 `version` 与（若有）`registry`：官方的「更新到某个版本」是按这两项执行的，
 * 缺 registry 它会按自己的顺序重试，可能装到另一个源上的同版本号。
 *
 * **失败也可能回 200**：官方把结果放在 `PluginUpdateResult.result.application` 里，不抛异常；
 * 只有服务缺失（503）与参数不合法（400）才走非 200。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginUpdateResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginUpdateBody>(event, { type: 'json' })
  if (typeof body?.name !== 'string' || body.name === '' || body.name.length > 200) {
    event.res.status = 400
    return { error: 'name and version are required' }
  }
  if (typeof body.version !== 'string' || body.version === '' || body.version.length > 100) {
    event.res.status = 400
    return { error: 'name and version are required' }
  }
  if (body.registry !== undefined && (typeof body.registry !== 'string' || body.registry === '')) {
    event.res.status = 400
    return { error: 'registry must be a non-empty string when given' }
  }
  try {
    return await deps.plugins.update({ name: body.name, version: body.version, ...(body.registry === undefined ? {} : { registry: body.registry }) })
  }
  catch (error) {
    return failure(event, error)
  }
})
