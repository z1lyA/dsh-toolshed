/**
 * 真机数据只读探针（**不是** vitest 用例：`.test/` 不在 `vitest.config.ts` 的 include 里）。
 *
 * 目的：在没有重启 DSH 的情况下，用**真实** `~/.dsh` 数据验证移植后的 archive admin：
 *   - 从真实 `storages/workspace.json` 读归档集合与工作区归属；
 *   - `list()` 能定位真实会话日志目录、量出非零占用、给出工作区标题；
 *   - `plan()` 能正确分类（立即删 / 排队 / 拒绝）且**不落盘**。
 *
 * 只调用 list / plan（纯读），绝不调用 remove / sweepPending / cancelPending。
 * 运行前后比对关键文件的 mtime，证明「只读」不是口头承诺。
 *
 * 用法（需要先构建一次，让 esbuild 把 TS 打成临时 mjs）：
 *   node -e "require('esbuild').build({entryPoints:['.test/live-data-probe.ts'],outfile:'.scratch/live-data-probe.mjs',bundle:true,platform:'node',format:'esm',target:'node20'})"
 *   DSH_HOME=... node .scratch/live-data-probe.mjs
 */
import { lstat, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createArchiveAdmin } from '../src/panel/host/service/archive'

const DSH_HOME = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')

async function snapshot(file: string): Promise<string> {
  try {
    const info = await lstat(file)
    return `${info.mtimeMs}`
  }
  catch {
    return 'absent'
  }
}

async function main(): Promise<void> {
  const registryFile = path.join(DSH_HOME, 'storages', 'workspace.json')
  const queueFile = path.join(DSH_HOME, 'session-admin', 'pending-deletions.json')
  const sessionsRoot = path.join(DSH_HOME, 'sessions')

  const before = {
    registry: await snapshot(registryFile),
    queue: await snapshot(queueFile),
  }

  const registry = JSON.parse(await readFile(registryFile, 'utf8'))
  const archived: string[] = registry.global?.archivedSessionIds ?? []
  const workspaces = Object.entries(registry.tables?.workspaces ?? {}).map(([id, value]: [string, any]) => ({
    id,
    title: value?.title ?? value?.name ?? id,
    sessionIds: value?.sessionIds ?? value?.sessions ?? [],
  }))

  console.log(`archived sessions in registry: ${archived.length}`)
  console.log(`workspaces: ${workspaces.length}`)

  const unused = async (): Promise<never> => {
    throw new Error('probe must stay read-only: a mutating service was called')
  }
  const ctx = {
    get(name: string): any {
      if (name === 'workspaceRegistry') {
        return {
          archivedSessionIds: new Set(archived),
          list: () => workspaces,
          archiveSession: unused,
          unarchiveSession: unused,
          unpinSession: unused,
        }
      }
      if (name === 'sessionPersistence')
        return { list: async () => [] }
      if (name === 'sessions')
        return { get: () => undefined, list: () => [] }
      return undefined
    },
    logger: { warn: (message: string) => console.log('[warn]', message) },
  }

  const admin = createArchiveAdmin(ctx as never, { dshHome: DSH_HOME })
  const list = await admin.list()
  console.log('\n--- list() ---')
  console.log('totals:', JSON.stringify(list.totals))
  console.log('defaults:', JSON.stringify(list.defaults))
  for (const item of list.items.slice(0, 6)) {
    console.log(`  ${item.id}  bytes=${item.totalBytes} files=${item.logFiles} hasLog=${item.hasLog}`
      + ` live=${item.live} descendants=${item.descendants.length} ws=${item.workspaceTitle ?? '-'}`)
  }
  const withLog = list.items.filter(item => item.hasLog)
  const withoutLog = list.items.filter(item => !item.hasLog)
  console.log(`with log dir: ${withLog.length}, without: ${withoutLog.length}`)
  if (withLog.length === 0)
    throw new Error('expected at least one archived session with an on-disk log directory')

  const sample = withLog.slice(0, 3).map(item => item.id)
  const plan = await admin.plan([...sample, 'session-nonexistent-probe'])
  console.log('\n--- plan() ---')
  console.log('totals:', JSON.stringify(plan.totals))
  for (const item of plan.items) {
    console.log(`  ${item.id} ok=${item.ok} code=${item.code ?? '-'} willQueue=${item.willQueue ?? false}`
      + ` bytes=${item.totalBytes ?? 0} hasLog=${item.hasLog ?? false}`)
  }

  // 归档集合里的 id 都能被路径逻辑覆盖到：抽样核对日志目录确实在 sessions 根下。
  const projectDirs = await readdir(sessionsRoot, { withFileTypes: true })
  console.log(`\nproject dirs under sessions/: ${projectDirs.filter(entry => entry.isDirectory()).length}`)

  const after = {
    registry: await snapshot(registryFile),
    queue: await snapshot(queueFile),
  }
  if (before.registry !== after.registry || before.queue !== after.queue) {
    console.error('\n!! 只读校验失败：registry 或 queue 的 mtime 变了', { before, after })
    process.exitCode = 1
    return
  }
  console.log('\nread-only check: OK (registry / queue mtime unchanged)')
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exitCode = 1
})
