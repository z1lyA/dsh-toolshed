/**
 * 内容寻址附件的安全删除（移植自 dsh-session-admin 的 `lib/attachments.js`）。
 *
 * DSH 按 digest 只存一份附件字节，同一对象天然被多个会话共用；没有引用计数，也没有删除接口。
 * 因此这里只在**完成**一轮引用扫描、证明剩余会话与宿主上传索引都不再提到它之后才删对象；
 * 扫描没跑完（读失败/超预算）时一个都不删。
 */
import { lstat, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { isInside, measureTree, removeTree } from './session-paths'

/** 一个持久附件 id：`sha256:` + 64 位小写十六进制。 */
const ATTACHMENT_ID = /sha256:([a-f0-9]{64})/g

/** 收集一段 JSON-like 值里出现的所有附件 id。 */
export function extractAttachmentIds(value: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(ATTACHMENT_ID))
        ids.add(match[0])
      return
    }
    if (Array.isArray(node)) {
      for (const item of node)
        walk(item)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const key of Object.keys(node))
        walk((node as Record<string, unknown>)[key])
    }
  }
  walk(value)
  return ids
}

/** 校验并剥掉 `sha256:` 前缀，失败返回 undefined（调用方据此跳过）。 */
export function digestOf(id: string): string | undefined {
  const match = /^sha256:([a-f0-9]{64})$/.exec(id)
  return match === null ? undefined : match[1]
}

/** 一个附件对象的所有落盘位置。 */
export function attachmentPaths(
  attachmentsRoot: string,
  digest: string,
): { object: string, fileObject: string, fileAlias: string } {
  const bucket = digest.slice(0, 2)
  return {
    object: path.join(attachmentsRoot, 'objects', bucket, digest),
    fileObject: path.join(attachmentsRoot, 'file-objects', bucket, digest),
    fileAlias: path.join(attachmentsRoot, 'files', bucket, digest),
  }
}

async function removeAttachmentObject(
  attachmentsRoot: string,
  digest: string,
): Promise<{ bytes: number, removed: boolean }> {
  const paths = attachmentPaths(attachmentsRoot, digest)
  for (const candidate of [paths.object, paths.fileObject, paths.fileAlias]) {
    if (!isInside(attachmentsRoot, candidate))
      throw new Error('attachment path escaped the attachment root')
  }
  let bytes = 0
  let removed = false
  for (const candidate of [paths.object, paths.fileObject, paths.fileAlias]) {
    let info
    try {
      info = await lstat(candidate)
    }
    catch (error: any) {
      if (error?.code === 'ENOENT')
        continue
      throw error
    }
    if (info.isDirectory()) {
      const measured = await measureTree(candidate)
      bytes += measured.bytes
      await removeTree(candidate)
      removed = true
      continue
    }
    if (!info.isFile())
      continue
    bytes += info.size
    await rm(candidate, { force: true })
    removed = true
  }
  return { bytes, removed }
}

/** 删除没有任何剩余引用的附件对象。 */
export async function pruneUnreferencedAttachments(input: {
  attachmentsRoot: string
  candidates: Iterable<string>
  referenced: Set<string>
}): Promise<{ freedBytes: number, deleted: string[], failed: Array<{ id: string, message: string }> }> {
  let freedBytes = 0
  const deleted: string[] = []
  const failed: Array<{ id: string, message: string }> = []
  for (const id of input.candidates) {
    if (input.referenced.has(id))
      continue
    const digest = digestOf(id)
    if (digest === undefined)
      continue
    try {
      const outcome = await removeAttachmentObject(input.attachmentsRoot, digest)
      freedBytes += outcome.bytes
      if (outcome.removed)
        deleted.push(id)
    }
    catch (error) {
      failed.push({ id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { freedBytes, deleted, failed }
}

/**
 * 读宿主上传索引里仍被提到的附件 id。
 *
 * 索引是带 TTL 的缓存，但未过期的条目还能在不重新上传的情况下重发文件，所以这里算引用。
 */
export async function readUploadIndexReferences(uploadIndexPath: string): Promise<Set<string>> {
  try {
    const text = await readFile(uploadIndexPath, 'utf8')
    return extractAttachmentIds(JSON.parse(text))
  }
  catch {
    return new Set()
  }
}

/**
 * 扫描剩余全部会话事件 + 上传索引中的附件引用。
 *
 * 全有或全无：超预算或读失败返回 `complete: false`，调用方必须以「全部保留」处置候选对象。
 */
export async function scanAttachmentReferences(input: {
  sessionIds: Iterable<string>
  readEvents: (sessionId: string) => Promise<unknown>
  uploadIndexPath: string
  budget?: { sessions?: number, events?: number, milliseconds?: number }
}): Promise<{ complete: boolean, referenced: Set<string>, reason?: string }> {
  const budget = input.budget ?? {}
  const maxSessions = budget.sessions ?? 500
  const maxEvents = budget.events ?? 200000
  const maxMilliseconds = budget.milliseconds ?? 90000
  const started = Date.now()
  const referenced = new Set<string>()
  let sessions = 0
  let events = 0
  for (const sessionId of input.sessionIds) {
    if (sessions >= maxSessions)
      return { complete: false, referenced, reason: 'session-budget' }
    if (Date.now() - started > maxMilliseconds)
      return { complete: false, referenced, reason: 'time-budget' }
    sessions += 1
    let page
    try {
      page = await input.readEvents(sessionId)
    }
    catch {
      return { complete: false, referenced, reason: 'read-failed' }
    }
    const rows = Array.isArray(page) ? page : []
    events += rows.length
    if (events > maxEvents)
      return { complete: false, referenced, reason: 'event-budget' }
    for (const id of extractAttachmentIds(rows))
      referenced.add(id)
  }
  for (const id of await readUploadIndexReferences(input.uploadIndexPath))
    referenced.add(id)
  return { complete: true, referenced }
}
