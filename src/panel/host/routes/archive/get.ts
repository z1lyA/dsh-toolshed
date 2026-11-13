import type { ArchiveListResponse, ExtensionRouteDeps } from '../index.types'
import { defineEventHandler, dshRouteDepsOf } from 'dsh-tauri'
import { failure } from '../failure'

/** GET /api/archived — 已归档会话清单（含占用与待删除状态）。 */
export default defineEventHandler(async (event): Promise<ArchiveListResponse | { error: string, code: string }> => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  try {
    return await deps.archive.list()
  }
  catch (error) {
    return failure(event, error)
  }
})
