/**
 * `restart` 的规格测试。
 *
 * 上游那份 `restart.test.mjs` 测的是 dsh-session-admin 的 CLI 语义（`DSH_DESKTOP === '1'`），
 * 迁移后重启实现换成了桌面版：判据是「Node 模式 + argv 指向 dsh-desktop-host + 有真实父进程」，
 * 并且多了一道安全闸（工作区里有活跃工作就拒绝重启）。这里按新实现重写规格，而不是照抄上游断言。
 *
 * 安全闸的三条豁免/拦截规则都来自 DSH 自己的更新/退出准入（`hasDesktopActiveTasks`）：
 * 运行中的回合、排队中的 inbox、running/stopping 的后台 job 会拦住重启；已归档会话豁免
 * （它们可能挂着空闲 live Agent，但那不是「工作区里正在跑的对话」）。
 *
 * 落盘只写 mkdtemp 出来的 dshHome：`execute()` 在非桌面进程下必须在写任何文件之前就抛错。
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRestartAdmin, inspectActiveWork, isDesktopHost, RestartUnavailableError } from './restart'

/** 真实桌面 Host 的进程事实：Node 模式的 Electron 子进程，argv 指向 dsh-desktop-host。 */
const desktopRuntime = {
  argv: ['node', '--expose-internals', 'C:/app/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' } as NodeJS.ProcessEnv,
  ppid: 4242,
}

const homes: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  homes.push(dir)
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

interface ContextOptions {
  archived?: string[]
  agents?: any[]
  jobs?: any[]
}

/** 假 ctx：只用 Map 装 `inspectActiveWork` 会按名字取的三类服务。 */
function context({ archived = [], agents = [], jobs = [] }: ContextOptions = {}): { get: (name: string) => any, logger: { warn: () => void } } {
  const services = new Map<string, any>([
    ['workspaceRegistry', { archivedSessionIds: archived }],
    ['agents', { list: () => agents }],
    [
      'jobs',
      {
        list: (caller?: string) => (caller === undefined ? jobs : jobs.filter(job => job.sessionId === caller)),
      },
    ],
  ])
  return { get: (name: string) => services.get(name), logger: { warn: () => {} } }
}

function agent(id: string, status = 'idle', inbox: any = {}): any {
  return { id, status, inbox: { nextTurn: [], nextStep: [], ...inbox } }
}

beforeEach(() => {
  // `createRestartAdmin` 的 check/execute 走的是 `isDesktopHost(process.argv, process.env, process.ppid)`
  // 默认值，所以用这个环境变量把「当前不是桌面宿主」钉死，避免在桌面壳里跑测试时行为漂移。
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })))
})

describe('isDesktopHost', () => {
  it('only accepts the Electron Node-mode Desktop child', () => {
    expect(isDesktopHost(desktopRuntime.argv, desktopRuntime.env, desktopRuntime.ppid)).toBe(true)
    // CLI 形态：argv 里没有 dsh-desktop-host
    expect(isDesktopHost(['node', 'cli.js'], desktopRuntime.env, desktopRuntime.ppid)).toBe(false)
    // 缺 Node 模式 env
    expect(isDesktopHost(desktopRuntime.argv, {}, desktopRuntime.ppid)).toBe(false)
    // ppid === 1：没有真实父进程，杀父进程等于杀掉整个会话/容器
    expect(isDesktopHost(desktopRuntime.argv, desktopRuntime.env, 1)).toBe(false)
  })
})

describe('inspectActiveWork', () => {
  it('reports no active work for a quiet workspace', () => {
    const result = inspectActiveWork(context(), desktopRuntime)
    expect(result.restartAvailable).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('reports a running non-archived session', () => {
    const result = inspectActiveWork(context({ agents: [agent('session-a', 'running')] }), desktopRuntime)
    expect(result.blockers).toEqual([{ id: 'session-a', kind: 'running' }])
  })

  it('ignores archived sessions, even when their Agent is live', () => {
    const result = inspectActiveWork(context({
      archived: ['session-a'],
      agents: [agent('session-a', 'running'), agent('session-b', 'idle')],
    }), desktopRuntime)
    expect(result.blockers).toEqual([])
  })

  it('reports queued inbox work and running jobs', () => {
    const result = inspectActiveWork(context({
      agents: [agent('session-a', 'idle', { nextTurn: [{}] }), agent('session-b', 'idle')],
      jobs: [
        { id: 'job-1', sessionId: 'session-b', status: 'running' },
        { id: 'job-2', sessionId: 'session-c', status: 'finished' },
      ],
    }), desktopRuntime)
    expect(result.blockers).toEqual([
      { id: 'session-a', kind: 'queued' },
      { id: 'session-b', kind: 'job' },
    ])
  })

  it('ignores jobs bound to archived sessions', () => {
    const result = inspectActiveWork(context({
      archived: ['session-a'],
      agents: [agent('session-a', 'running')],
      jobs: [{ id: 'job-1', sessionId: 'session-a', status: 'running' }],
    }), desktopRuntime)
    expect(result.blockers).toEqual([])
  })

  it('reports restart as unavailable outside the Desktop Host', () => {
    const result = inspectActiveWork(context(), {
      argv: ['node', 'cli.js'],
      env: {},
      ppid: 4242,
    })
    expect(result.restartAvailable).toBe(false)
    expect(result.reason).toBe('not-desktop-host')
  })

  it('活跃工作只是信息，不再有「能不能重启」这个判据（2.6.0 去掉了安全闸）', () => {
    const result = inspectActiveWork(context({ agents: [agent('session-a', 'running')] }), desktopRuntime)
    expect(result).not.toHaveProperty('canRestart')
    expect(result.restartAvailable).toBe(true)
  })
})

describe('createRestartAdmin', () => {
  it('refuses to execute outside the Desktop Host and still exposes the log file', async () => {
    const home = await workspace('dsa-restart-')
    const admin = createRestartAdmin(context(), { dshHome: home })
    const logFile = path.join(home, 'session-admin', 'restart.log')
    expect(admin.logFile).toBe(logFile)

    const status = admin.check()
    expect(status.logFile).toBe(logFile)
    expect(status.restartAvailable).toBe(false)
    expect(status.reason).toBe('not-desktop-host')

    const failure = await admin.execute().catch(error => error)
    expect(failure).toBeInstanceOf(RestartUnavailableError)
    expect(failure.code).toBe('restart-unavailable')
    // 被拒绝的路径必须在写任何文件之前返回：连状态目录都不该出现。
    expect(await exists(path.join(home, 'session-admin'))).toBe(false)
  })

  it('有活跃工作时不再回 restart-blocked：拒绝理由只剩「不是桌面进程」', async () => {
    const home = await workspace('dsa-restart-busy-')
    const admin = createRestartAdmin(context({ agents: [agent('session-a', 'running')] }), { dshHome: home })

    expect(admin.check().blockers).toEqual([{ id: 'session-a', kind: 'running' }])
    const failure = await admin.execute().catch(error => error)
    // 非桌面环境照样拒绝，但理由必须是 restart-unavailable——安全闸已经不存在了。
    expect(failure.code).toBe('restart-unavailable')
  })
})
