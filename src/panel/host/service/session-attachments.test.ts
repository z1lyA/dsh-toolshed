/**
 * `session-attachments` 的规格测试（语义 1:1 移植自 dsh-session-admin 的 `test/attachments.test.mjs`）。
 *
 * 重点规格是「全有或全无」：引用扫描不完整（读失败 / 超预算）时一个对象都不许删；
 * 只有证明剩余会话与上传索引都不再引用它，才动盘。所有落盘都在 mkdtemp 出来的目录里。
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  attachmentPaths,
  digestOf,
  extractAttachmentIds,
  pruneUnreferencedAttachments,
  readUploadIndexReferences,
  scanAttachmentReferences,
} from './session-attachments'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const ID_A = `sha256:${HASH_A}`
const ID_B = `sha256:${HASH_B}`
const ID_C = `sha256:${HASH_C}`

const workspaces: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  workspaces.push(dir)
  return dir
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  }
  catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })))
})

describe('extractAttachmentIds', () => {
  it('walks nested events', () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: ID_A } }] } },
      { type: 'tool/result', data: { message: { content: [{ type: 'file', attachment: { attachmentId: ID_B } }] } } },
      { type: 'text', data: { text: `no attachment here ${'a'.repeat(64)}` } },
    ]
    const ids = extractAttachmentIds(events)
    expect([...ids].sort()).toEqual([ID_A, ID_B].sort())
  })
})

describe('digestOf', () => {
  it('validates the id shape', () => {
    expect(digestOf(ID_A)).toBe(HASH_A)
    expect(digestOf('sha256:xyz')).toBeUndefined()
    expect(digestOf(`md5:${HASH_A}`)).toBeUndefined()
  })
})

describe('pruneUnreferencedAttachments', () => {
  it('removes only unreferenced objects', async () => {
    const root = await workspace('dsa-attach-')
    const rootV1 = path.join(root, 'v1')
    for (const [digest, name] of [[HASH_A, 'a.txt'], [HASH_B, 'b.txt'], [HASH_C, 'c.txt']]) {
      const paths = attachmentPaths(rootV1, digest)
      await mkdir(path.dirname(paths.object), { recursive: true })
      await mkdir(path.dirname(paths.fileObject), { recursive: true })
      await mkdir(paths.fileAlias, { recursive: true })
      await writeFile(paths.object, 'x'.repeat(10))
      await writeFile(paths.fileObject, 'x'.repeat(20))
      await writeFile(path.join(paths.fileAlias, name), 'x'.repeat(30))
    }
    const outcome = await pruneUnreferencedAttachments({
      attachmentsRoot: rootV1,
      candidates: [ID_A, ID_C],
      referenced: new Set([ID_B]),
    })
    expect(outcome.deleted.length).toBe(2)
    expect(outcome.failed.length).toBe(0)
    // 每个对象 10（objects）+ 20（file-objects）+ 30（files 别名）＝ 60 字节
    expect(outcome.freedBytes).toBe(60 * 2)
    expect(await exists(attachmentPaths(rootV1, HASH_A).object)).toBe(false)
    expect(await exists(attachmentPaths(rootV1, HASH_C).object)).toBe(false)
    // 被引用的对象三处都必须留下
    expect(await exists(path.join(attachmentPaths(rootV1, HASH_B).fileAlias, 'b.txt'))).toBe(true)
  })
})

describe('scanAttachmentReferences', () => {
  it('returns incomplete when one session cannot be read', async () => {
    const root = await workspace('dsa-scan-')
    const outcome = await scanAttachmentReferences({
      sessionIds: ['session-ok', 'session-broken'],
      readEvents: async (id) => {
        if (id === 'session-broken')
          throw new Error('unreadable')
        return [{ data: { attachmentId: ID_A } }]
      },
      uploadIndexPath: path.join(root, 'missing.json'),
    })
    expect(outcome.complete).toBe(false)
    expect(outcome.reason).toBe('read-failed')
  })

  it('combines sessions and the upload index', async () => {
    const root = await workspace('dsa-scan2-')
    const index = path.join(root, 'files-v3.json')
    await writeFile(index, JSON.stringify({ records: [{ attachmentId: ID_C }] }))
    const outcome = await scanAttachmentReferences({
      sessionIds: ['session-keep'],
      readEvents: async () => [{ data: { attachmentId: ID_A } }],
      uploadIndexPath: index,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.referenced.has(ID_A)).toBe(true)
    expect(outcome.referenced.has(ID_C)).toBe(true)
  })

  it('stops at its event budget', async () => {
    const root = await workspace('dsa-scan3-')
    const outcome = await scanAttachmentReferences({
      sessionIds: ['session-one'],
      readEvents: async () => [{ one: 1 }, { two: 2 }],
      uploadIndexPath: path.join(root, 'missing.json'),
      budget: { events: 1 },
    })
    expect(outcome.complete).toBe(false)
    expect(outcome.reason).toBe('event-budget')
  })
})

describe('readUploadIndexReferences', () => {
  it('reads missing or malformed files as empty', async () => {
    const root = await workspace('dsa-index-')
    expect((await readUploadIndexReferences(path.join(root, 'missing.json'))).size).toBe(0)
    const malformed = path.join(root, 'bad.json')
    await writeFile(malformed, '{not json')
    expect((await readUploadIndexReferences(malformed)).size).toBe(0)
  })
})
