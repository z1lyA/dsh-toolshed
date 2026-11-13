/**
 * `pending-deletions` 的规格测试（语义 1:1 移植自 dsh-session-admin 的 `test/pending.test.mjs`）。
 *
 * 队列是插件私有状态，但它是**跨进程持久**的：损坏的文件必须抛错而不是静默重置
 * （静默重置会丢掉用户已排队的删除意图），非法 id 与重复条目读时丢弃，写入有条数上限。
 * 每个用例一个 mkdtemp 出来的 home，绝不碰真实 `~/.dsh`。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PENDING_MAX,
  createPendingEntry,
  pendingFilePath,
  pluginStateDir,
  readPending,
  writePending,
} from './pending-deletions'

const homes: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  homes.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })))
})

describe('createPendingEntry', () => {
  it('carries the optimization intent', () => {
    const entry = createPendingEntry('session-abc', false)
    expect(entry.id).toBe('session-abc')
    expect(entry.cleanupAttachments).toBe(false)
    expect(entry.attempts).toBe(0)
    expect(entry.lastError).toBeNull()
    expect(typeof entry.requestedAt).toBe('string')
  })
})

describe('writePending / readPending', () => {
  it('round-trips entries', async () => {
    const home = await workspace('dsa-pending-')
    const entries = [
      createPendingEntry('session-a', true),
      { ...createPendingEntry('session-b', false), attempts: 2, lastError: 'session-live' },
    ]
    await writePending(home, entries)
    const file = pendingFilePath(home)
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.entries.length).toBe(2)
    expect(await readPending(home)).toEqual(entries)
  })

  it('treats a missing file as an empty queue', async () => {
    const home = await workspace('dsa-pending-missing-')
    expect(await readPending(home)).toEqual([])
  })

  it('rejects malformed or unsupported files instead of silently resetting them', async () => {
    const home = await workspace('dsa-pending-bad-')
    await mkdir(pluginStateDir(home), { recursive: true })
    const file = pendingFilePath(home)
    await writeFile(file, '{not json')
    await expect(readPending(home)).rejects.toThrow(/not valid JSON/)
    await writeFile(file, JSON.stringify({ version: 99, entries: [] }))
    await expect(readPending(home)).rejects.toThrow(/unsupported shape/)
  })

  it('drops invalid ids and duplicate entries', async () => {
    const home = await workspace('dsa-pending-filter-')
    await mkdir(pluginStateDir(home), { recursive: true })
    await writeFile(pendingFilePath(home), JSON.stringify({
      version: 1,
      entries: [
        { id: '../escape', requestedAt: 'x' },
        { id: 'session-a' },
        { id: 'session-a' },
        { id: 'session-b', cleanupAttachments: false },
      ],
    }))
    const read = await readPending(home)
    expect(read.map(entry => entry.id)).toEqual(['session-a', 'session-b'])
    expect(read[1].cleanupAttachments).toBe(false)
    expect(read[0].attempts).toBe(0)
  })
})

describe('writePending', () => {
  it('refuses an unbounded queue', async () => {
    const home = await workspace('dsa-pending-cap-')
    const entries = Array.from({ length: PENDING_MAX + 1 }, (_, index) => createPendingEntry(`session-${index}`, true))
    await expect(writePending(home, entries)).rejects.toThrow(/exceeds/)
  })
})
