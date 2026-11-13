import type { HostContext } from 'dsh-tauri'
import type { Config } from './apply.types'
import type { ArchiveAdmin, HostServiceHub } from './service/archive'
import type { PanelExtensionHost } from './types'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import { PLUGIN_ID } from '../shared/constants'
import { clearHostRuntime, resetProviderRuntime, setCurrentHostInstance } from './config/runtime'
import { routes } from './routes'
import { createArchiveAdmin } from './service/archive'
import { profile } from './service/profile'
import { provider } from './service/provider'
import { createRestartAdmin } from './service/restart'

const DEFAULT_PROFILE = 'web'

export type { Config } from './apply.types'

export const name = PLUGIN_ID

export const inject = ['webServer', 'skills', 'connection']

export { loadFilesystemSkillPlugin } from './service/provider.utils'

export function packagedSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

export function apply(ctx: HostContext, config?: Config): void {
  ctx.inject(inject, (hostCtx) => {
    setCurrentHostInstance(hostCtx as unknown as PanelExtensionHost)
    resetProviderRuntime()
    const remountProvider = (): Promise<void> => provider.start(packagedSkillsDir())
    const profileDirPath = profile.peek(config?.profile ?? profile.resolve() ?? DEFAULT_PROFILE)

    // 会话数据的所有者：只按名字取服务，**不**把 workspaceRegistry / sessionPersistence
    // 写进导出的 inject —— 缺这些服务的组合会让整个面板（含 MCP / 技能）一起不挂载。
    const hub = hostCtx as unknown as HostServiceHub
    const sessionConfig = {
      dshHome: config?.dshHome,
      sessionsRoot: config?.sessionsRoot,
      storagesRoot: config?.storagesRoot,
      attachmentsRoot: config?.attachmentsRoot,
      cleanupAttachmentsDefault: config?.cleanupAttachmentsDefault,
    }
    const archive = createArchiveAdmin(hub, sessionConfig)
    const restart = createRestartAdmin(hub, sessionConfig)

    ctx.effect(() => startProvider(remountProvider), 'dsh-mcp-studio: skill provider')
    ctx.effect(
      () => routes(hostCtx as unknown as HostContext, { profileDirPath, remountProvider, archive, restart }),
      'dsh-mcp-studio: routes',
    )
    sweepPendingOnBoot(hostCtx, archive)
    prunePendingOnUnarchive(hostCtx, archive)
    return clearHostRuntime
  })
}

function startProvider(remountProvider: () => Promise<void>): () => void {
  void remountProvider()
  return clearHostRuntime
}

/**
 * 队列里的删除只能在「没有对话活着」时执行。
 *
 * 插件在 Host 启动时激活，早于浏览器打开任何会话，所以在这里执行队列，并让开启动路径
 * （`setTimeout` + `ctx.effect` 的 dispose 都能取消它）。
 *
 * 整段用 try/catch 兜住：这里是**附加能力**，任何一个 cordis 组合差异都不该让整个面板
 * （含 MCP / 技能）一起挂不上——失败时退化成「队列等下次启动再说」，页面仍能手动取消。
 */
function sweepPendingOnBoot(ctx: HostContext, archive: ArchiveAdmin): void {
  const hostCtx = ctx as unknown as HostContext & { inject: (names: string[], callback: (ready: any) => void) => void }
  try {
    hostCtx.inject(['workspaceRegistry', 'sessionPersistence'], (ready: any) => {
      ready.effect(() => {
        let disposed = false
        const timer = setTimeout(() => {
          if (disposed)
            return
          archive.sweepPending().then((summary) => {
            try {
              if ((summary?.totals?.queued ?? 0) > 0) {
                ctx.logger?.info?.(
                  `[dsh-mcp-studio] pending deletions: queued=${summary.totals.queued} deleted=${summary.totals.deleted} `
                  + `kept=${summary.totals.kept} dropped=${summary.totals.dropped} freed=${summary.totals.freedBytes}`,
                )
              }
            }
            catch {
              /* 日志失败绝不能影响清扫 */
            }
          }).catch((error) => {
            try {
              ctx.logger?.warn?.(`[dsh-mcp-studio] pending deletion sweep failed: ${error instanceof Error ? error.message : String(error)}`)
            }
            catch {
              /* 同上 */
            }
          })
        }, 500)
        return () => {
          disposed = true
          clearTimeout(timer)
        }
      }, 'dsh-mcp-studio: pending sweep')
    })
  }
  catch (error) {
    try {
      ctx.logger?.warn?.(`[dsh-mcp-studio] pending sweep not mounted: ${error instanceof Error ? error.message : String(error)}`)
    }
    catch {}
  }
}

/**
 * 取消归档要立刻撤掉待删除意图——包括在原生侧栏菜单或另一个标签页里取消。
 *
 * 归档集合在 workspace 域的全局单例里（`table === ''`），所以只对那一条变更反应。
 * 同样整段兜住：监听装不上只是「队列清理慢一点」，不该影响面板其它 tab。
 */
function prunePendingOnUnarchive(ctx: HostContext, archive: ArchiveAdmin): void {
  const hostCtx = ctx as unknown as HostContext & { inject: (names: string[], callback: (ready: any) => void) => void }
  try {
    hostCtx.inject(['workspaceRegistry'], (ready: any) => {
      ready.effect(() => {
        const off = ready.on('domain/changed', (change: any) => {
          if (change === null || typeof change !== 'object')
            return
          if (change.domain !== 'workspace')
            return
          if (change.table !== '')
            return
          archive.schedulePrune()
        })
        return () => {
          try {
            off()
          }
          catch {
            /* 已释放 */
          }
        }
      }, 'dsh-mcp-studio: prune pending on workspace change')
    })
  }
  catch (error) {
    try {
      ctx.logger?.warn?.(`[dsh-mcp-studio] workspace-change prune not mounted: ${error instanceof Error ? error.message : String(error)}`)
    }
    catch {}
  }
}
