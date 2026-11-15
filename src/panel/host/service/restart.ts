/**
 * 桌面进程级重启（移植自 dsh-session-admin 的 `lib/restart.js`）。
 *
 * DSH 没有给插件暴露「重启桌面应用」的接口：`app.relaunch()` 只在 Electron 主进程里，
 * 桌面 preload 桥没有 restart 通道（本机 app.asar 里 `restartSidecar` 零命中，已验证），
 * Host→主进程 IPC 又是白名单。所以这里做的是**受保护的进程级重启**：
 *
 *   1. 检查工作区里的活跃工作（已归档会话豁免），有交叉就拒绝并列出原因；
 *   2. 写重启计划，用 Node 模式拉起一个脱离进程树的助手工（`restart-helper.js`）；
 *   3. HTTP 回复落地后强杀当前 Electron 进程树；
 *   4. 助手等旧进程退出、单实例锁释放，再以普通 GUI 方式拉起同一个可执行文件。
 *
 * 为什么替换掉上游那份：上游实现是按 `dsh` CLI 语义重新 exec argv，判据是
 * `DSH_DESKTOP === '1'`；而 Desktop 里 Host 进程的 argv 是 `...\dsh-desktop-host\lib\index.js`，
 * 既不匹配它的正则、桌面壳也没设那个环境变量，实际会落到 `cmd /c dsh` 兜底分支；
 * 同时它没有任何「有会话在跑就拦住」的安全闸。这一份在本机有多次成功重启记录可查
 * （`$DSH_HOME/session-admin/restart.log`）。
 */
import type { HostServiceHub } from './archive'
import type { RestartRuntime, RestartAdmin } from './restart.types'
import type { SessionRootsConfig } from './session-paths'
import type { RestartBlockerView, RestartLaunchResponse, RestartStatusResponse } from './archive.types'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ArchiveRequestError } from './archive'
import { pluginStateDir } from './pending-deletions'
import { resolveRoots } from './session-paths'

/** 当前 Host 进程不能执行该操作。 */
export class RestartUnavailableError extends ArchiveRequestError {
  constructor(message: string) {
    super('restart-unavailable', message)
    this.name = 'RestartUnavailableError'
  }
}

/**
 * 桌面宿主脚本在 argv 里的形状：`...\dsh-desktop-host\lib\index.js`（路径段，不是任意子串）。
 *
 * 用路径段而不是 `includes()`：CLI 参数里完全可能出现 `...\dsh-desktop-host\...` 这样的目录
 * （cwd、profile 路径），而误判的代价是 `taskkill /T` 掉用户的终端。
 */
const DESKTOP_HOST_ENTRY = /(^|[\\/])dsh-desktop-host([\\/]|$)/i

/**
 * 当前 Host 是不是「拥有这个应用」的那个 Electron 子进程。
 *
 * CLI / Web 形态的 `dsh` 绝不能去杀自己的父 shell：判据要求 Node 模式 + argv 里带
 * `dsh-desktop-host` 路径段 + 有真实父进程。
 */
export function isDesktopHost(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  ppid: number = process.ppid,
): boolean {
  return env.ELECTRON_RUN_AS_NODE === '1'
    && Array.isArray(argv)
    && argv.some(argument => typeof argument === 'string' && DESKTOP_HOST_ENTRY.test(argument))
    && Number.isSafeInteger(ppid)
    && ppid > 1
}

/**
 * 汇报工作区里仍在进行的工作。
 *
 * **这些不再拦截重启**（2.6.0 起）：它们只是「点了重启会发生什么」的实情，页面拿去做措辞。
 * 早先这里是安全闸（有交叉就 409 拒绝），但用户的实际体验是「绝大多数时候都点不动」——
 * 他点重启之前已经自己确认过没有要继续的东西了。
 *
 * 已归档会话刻意豁免：它们可能还挂着空闲 live Agent，但那不是「工作区里正在跑的对话」。
 * 运行中的回合、排队中的 inbox、running/stopping 的后台 job 都会列出来。
 */
export function inspectActiveWork(ctx: HostServiceHub, runtime: RestartRuntime = {}): RestartStatusResponse {
  const get = (name: string): any => {
    try {
      if (typeof ctx.get === 'function')
        return ctx.get(name)
    }
    catch {}
    try {
      return ctx[name]
    }
    catch {
      return undefined
    }
  }
  const registry = get('workspaceRegistry')
  const agents = get('agents')
  const jobs = get('jobs')
  const archived = new Set<string>([...(registry?.archivedSessionIds ?? [])].map(String))
  // 服务在拆卸期可能抛错：这里任何一次抛出都会让 GET /api/host/restart 变成 500，
  // 而「查不到活跃工作」本身是个安全的默认值（不拦、由后续 execute 再判一次）。
  let live: any[] = []
  try {
    const listed = agents?.list?.()
    live = Array.isArray(listed) ? listed : []
  }
  catch {
    live = []
  }
  const blockers: RestartBlockerView[] = []
  for (const agent of live) {
    const id = String(agent?.id ?? agent?.session?.id ?? '')
    if (id === '' || archived.has(id))
      continue
    if (agent.status === 'running') {
      blockers.push({ id, kind: 'running' })
      continue
    }
    if ((agent.inbox?.nextTurn?.length ?? 0) > 0 || (agent.inbox?.nextStep?.length ?? 0) > 0)
      blockers.push({ id, kind: 'queued' })
  }
  const seenJobs = new Set<string>()
  const considerJobs = (list: unknown): void => {
    for (const job of Array.isArray(list) ? list : []) {
      if (job === null || typeof job !== 'object')
        continue
      const key = String(job.id ?? `${job.sessionId ?? ''}:${job.status ?? ''}`)
      if (seenJobs.has(key))
        continue
      seenJobs.add(key)
      if (job.status !== 'running' && job.status !== 'stopping')
        continue
      const sessionId = String(job.sessionId ?? '')
      if (sessionId !== '' && archived.has(sessionId))
        continue
      blockers.push({ id: sessionId || key, kind: 'job' })
    }
  }
  considerJobs(jobs?.list?.())
  for (const agent of live) {
    const id = String(agent?.id ?? agent?.session?.id ?? '')
    if (id === '' || archived.has(id))
      continue
    considerJobs(jobs?.list?.(id))
  }
  const available = isDesktopHost(runtime.argv, runtime.env, runtime.ppid)
  return {
    restartAvailable: available,
    blockers,
    ...(available ? {} : { reason: 'not-desktop-host' }),
  }
}

/**
 * 构造绑定到一次 apply 的重启 admin。
 *
 * @param ctx 宿主 ctx（只用 `get`）
 * @param config 行配置，用于解析 DSH home（重启计划与日志落在其中）
 */
export function createRestartAdmin(ctx: HostServiceHub, config: SessionRootsConfig = {}): RestartAdmin {
  const roots = resolveRoots(config)
  const stateDir = pluginStateDir(roots.home)
  const planFile = path.join(stateDir, 'restart-plan.json')
  const logFile = path.join(stateDir, 'restart.log')
  // 构建产物是 lib/index.js，助手是同目录的独立入口（scripts/build.mjs 单独产出）。
  const helperFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'restart-helper.js')
  let restarting = false

  const check = (): RestartStatusResponse => ({
    ...inspectActiveWork(ctx),
    logFile,
  })

  const execute = async (): Promise<RestartLaunchResponse> => {
    if (restarting)
      throw new RestartUnavailableError('a restart is already in progress')
    const inspection = inspectActiveWork(ctx)
    if (!inspection.restartAvailable)
      throw new RestartUnavailableError('restart is only available in the DSH Desktop application')
    // 这里**不再**因为「有活跃工作」而拒绝（2.6.0，用户要求）：`blockers` 只用于在确认弹窗里如实提示，
    // 点确认就执行。用户自己承担「重启会中断正在跑的回合」这件事——他点之前已经确认过了。
    if (!existsSync(helperFile)) {
      // 缺助手文件就绝不会把应用杀掉后起不来：宁可现在明确失败。
      throw new RestartUnavailableError(`restart helper is missing: ${helperFile}`)
    }
    // ⚠ `executable` 必须在使用前声明：这是 `const`，在 TDZ 里被引用会抛 ReferenceError，
    // 而 Windows 上这一行是必执行的——曾经的写法让「重启」在 win32 上直接 500（TS2448 早就报过）。
    const executable = process.execPath
    // cmd.exe 的 `%VAR%` 展开不受双引号保护：路径里带 `%` 时助手会拿到被吃掉一段的路径，
    // 结果是「应用被杀掉、没人重拉」。这种情况宁可不重启。
    if (process.platform === 'win32' && [executable, helperFile, planFile].some(value => value.includes('%')))
      throw new RestartUnavailableError('restart path contains "%", which cmd.exe would expand; reopen the app manually')
    restarting = true

    const parentPid = process.ppid
    const plan = {
      parentPid,
      executable,
      args: [] as string[],
      cwd: path.dirname(executable),
      waitMs: 30000,
      logFile,
      createdAt: new Date().toISOString(),
    }
    await mkdir(stateDir, { recursive: true })
    await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })

    // 助手用 Node 模式跑 Electron 可执行文件。Windows 上经 `cmd /c start` 拉起，
    // 这样它不在 taskkill /T 终止的进程树里；JSON 走计划文件，避免 shell 引号地狱。
    const helperEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_RESTART_LOG: logFile }
    try {
      if (process.platform === 'win32') {
        const command = `start "" /B "${executable}" "${helperFile}" "${planFile}"`
        const launcher = spawn(process.env.ComSpec || 'cmd.exe', ['/c', command], {
          env: helperEnv,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true,
        })
        launcher.unref()
      }
      else {
        const helper = spawn(executable, [helperFile, planFile], {
          env: helperEnv,
          cwd: plan.cwd,
          detached: true,
          stdio: 'ignore',
        })
        helper.unref()
      }
    }
    catch (error) {
      restarting = false
      throw new RestartUnavailableError(`could not start the restart helper: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 先让 HTTP 回复冲刷出去，再终止应用：旧进程树包含本 Host，脱离的助手会活下来，
    // 在单实例锁释放后拉起替代进程。
    const terminate = (): void => {
      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(parentPid), '/F', '/T'], {
            stdio: 'ignore',
            windowsHide: true,
          })
          killer.unref()
        }
        else {
          process.kill(parentPid, 'SIGKILL')
        }
      }
      catch {
        /* 旧进程退出后助手仍会尝试重拉 */
      }
    }
    const timer = setTimeout(terminate, 750)
    timer.unref?.()
    try {
      await appendFile(logFile, `${new Date().toISOString()} restart requested for pid ${parentPid}\n`)
    }
    catch {
      /* 日志绝不能挡住重启 */
    }
    return { ok: true, parentPid, planFile, logFile }
  }

  return { check, execute, logFile }
}
