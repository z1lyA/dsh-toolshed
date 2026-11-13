import type { EventHandlerRequest } from 'dsh-tauri'
import type { ArchiveCancelBody, ArchiveCancelResponse, ExtensionRouteDeps } from '../../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../../failure'

/** POST /api/archive/pending/cancel — 取消排队中的删除（磁盘上什么都没动）。 */
export default defineEventHandler<EventHandlerRequest, Promise<ArchiveCancelResponse | { error: string, code: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<ArchiveCancelBody>(event, { type: 'json' })
  if (body === undefined || !Array.isArray(body.ids)) {
    event.res.status = 400
    return { error: 'ids must be an array', code: 'invalid-request' }
  }
  try {
    return await deps.archive.cancelPending(body.ids)
  }
  catch (error) {
    return failure(event, error)
  }
})
