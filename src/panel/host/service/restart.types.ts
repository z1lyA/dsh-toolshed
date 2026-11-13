import type { RestartLaunchResponse, RestartStatusResponse } from './archive.types'

/** 进程事实，可在测试里覆盖（生产一律取 process.*）。 */
export interface RestartRuntime {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  ppid?: number
}

export interface RestartAdmin {
  /** 只读探测：能否重启、被什么挡住。 */
  check: () => RestartStatusResponse
  /** 执行进程级重启（成功时 Host 会在回复后自行退出）。 */
  execute: () => Promise<RestartLaunchResponse>
  /** 重启日志文件（页面展示用）。 */
  logFile: string
}
