import { existsSync } from 'node:fs'
import { defineService } from 'dsh-tauri'
import { getCurrentHostInstance, providerRuntime } from '../config/runtime'
import { providerHooks } from '../events'
import { loadFilesystemSkillPlugin } from './provider.utils'
import { skills } from './skills'

export const provider = defineService({
  start(packagedDir: string): Promise<void> {
    providerRuntime.chain = providerRuntime.chain
      .then(() => remount(packagedDir))
      .catch((error: unknown) => {
        void providerHooks.callHook('provider:error', error)
        const message = error instanceof Error ? error.message : String(error)
        getCurrentHostInstance().logger.error(`dsh-toolshed: failed to mount filesystem skill provider: ${message}`)
      })
    return providerRuntime.chain
  },
})

// --- internal ---

async function remount(packagedDir: string): Promise<void> {
  if (providerRuntime.disposed)
    return
  void providerHooks.callHook('provider:before-remount')
  const host = getCurrentHostInstance()
  const plugin = await loadFilesystemSkillPlugin(host.loader)
  if (providerRuntime.fiber !== undefined) {
    const old = providerRuntime.fiber
    providerRuntime.fiber = undefined
    try {
      await old.dispose()
    }
    catch {}
  }
  if (providerRuntime.disposed)
    return
  /**
   * 只挂我们自己的东西：随包自带的技能 + 用户在面板里手动导入的根。
   *
   * **不再自动挂 `~/.claude/skills` / `~/.codex/skills`**（2.6.3 移除，用户确认）：
   * DSH 0.2.2 起原生就扫 `~/.agents/skills`（`user-agents`），而 Matt 那套安装器会用 junction
   * 把 `.claude/skills/<name>` 指回 `.agents/skills/<name>`——同一批真实目录被扫第二遍，
   * 又因为 DSH 去重时取 rank 最小（`custom 300` < `user-agents 500`），自定义那份会**赢走标签**，
   * 于是用户看到的是一整组「自定义」的 Matt 技能包，而「用户」组只剩 `.agents` 独有的那些。
   * 自动挂载只是 DSH 还不认识 `.agents/skills` 年代的兼容做法，现在纯属抢标签。
   */
  const roots = [
    packagedDir,
    ...(await skills.listSources()).flatMap(entry => entry.roots),
  ].filter(dir => existsSync(dir))
  try {
    providerRuntime.fiber = host.plugin(plugin, roots.length > 0 ? { customSkillDirs: roots } : {})
    void providerHooks.callHook('provider:after-remount', roots)
  }
  catch (error) {
    void providerHooks.callHook('provider:error', error)
  }
}
