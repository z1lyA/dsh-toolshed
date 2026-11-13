/**
 * 脱离进程树的重启助手（移植自 dsh-session-admin 的 `lib/restart-helper.js`）。
 *
 * 本文件由 `restart.ts` 以 `ELECTRON_RUN_AS_NODE=1` 拉起，构建为**独立入口**
 * （`lib/restart-helper.js`）：host 主产物是单文件 bundle，而这里必须是磁盘上真实存在的
 * 独立脚本，才能在拉起它的 Host 被杀掉之后继续活着。
 *
 * 它不依赖 DSH 运行时：读计划、等旧进程消失、再以普通 GUI 方式重拉同一个可执行文件。
 *
 * ⚠️ 不要从任何地方 import 这个模块——它在顶层就会执行 main()。
 */
import { spawn } from 'node:child_process'
import { appendFile, readFile, rm } from 'node:fs/promises'
import process from 'node:process'

const planFile = process.argv[2]

const log = async (message: string): Promise<void> => {
  try {
    await appendFile(process.env.DSH_RESTART_LOG || '', `${new Date().toISOString()} ${message}\n`)
  }
  catch {
    /* 没有日志目的地也仍然要尝试重拉 */
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error: any) {
    return error !== null && typeof error === 'object' && error.code === 'EPERM'
  }
}

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

async function main(): Promise<void> {
  if (typeof planFile !== 'string' || planFile === '')
    throw new Error('restart plan path is missing')
  const plan = JSON.parse(await readFile(planFile, 'utf8'))
  process.env.DSH_RESTART_LOG = plan.logFile
  await log(`helper started for old pid ${String(plan.parentPid)}`)
  try {
    await rm(planFile, { force: true })
  }
  catch {
    /* 计划文件是一次性的 */
  }
  if (!Number.isSafeInteger(plan.parentPid) || plan.parentPid <= 1)
    throw new Error('invalid old process id')
  if (typeof plan.executable !== 'string' || plan.executable === '')
    throw new Error('restart executable is missing')

  const deadline = Date.now() + (Number.isFinite(plan.waitMs) ? plan.waitMs : 30000)
  while (alive(plan.parentPid) && Date.now() < deadline)
    await sleep(200)
  if (alive(plan.parentPid)) {
    await log('old process did not exit before the deadline; aborting relaunch')
    return
  }
  await log('old process exited; releasing single-instance lock')
  await sleep(600)

  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.DSH_DESKTOP_NODE_EXECUTABLE
  delete env.DSH_DESKTOP_NODE_BIN
  delete env.DSH_RESTART_LOG
  const args = Array.isArray(plan.args) ? plan.args.filter((value: unknown) => typeof value === 'string') : []
  const child = spawn(plan.executable, args, {
    cwd: typeof plan.cwd === 'string' && plan.cwd !== '' ? plan.cwd : undefined,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  await log(`relaunch spawned pid ${String(child.pid ?? 'unknown')}`)
}

main().catch(async (error) => {
  await log(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
