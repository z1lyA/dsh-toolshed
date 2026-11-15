import type { PluginInstallResponse, PluginInspectResponse } from '../apis/index.type'
import type { Translate } from '../locales/index.types'

/**
 * 两个分支从线协议里 `Extract` 出来，而不是在客户端另写一份字段表。
 *
 * `strict: false` 下 TS 不按 `status` 字面量收窄联合（见 AGENTS 约定），所以这里显式给出两个别名，
 * 调用方用 `as PluginInspectAccepted` 断言一次，比在每个字段上写 `?.` 更能暴露「宿主没发这个字段」。
 */
export type PluginInspectAccepted = Extract<PluginInspectResponse, { status: 'accepted' }>
export type PluginInspectRefused = Extract<PluginInspectResponse, { status: 'refused' }>

/**
 * 弹窗状态机：`idle → checking → accepted|refused → installing → installed|failed`，
 * 外加 `pending-builds`（官方要用户显式批准安装脚本时停在的那一格）。
 *
 * 为什么不合并成 `busy + result`：这些格子对用户的意义完全不同（正在查、查到了、查不了、
 * 正在装、要批准、装好了、装失败），每格能做的事也不一样（只有 accepted 能点「安装」）。
 */
export type PluginInstallPhase =
  | 'idle'
  | 'checking'
  | 'accepted'
  | 'refused'
  | 'installing'
  | 'pending-builds'
  | 'installed'
  | 'failed'

export interface PluginInstallDialogProps {
  t: Translate
  open: boolean
  onClose: () => void
  /** 装成功一次就通知父组件重拉包列表（不自动关弹窗：用户要先看到结果）。 */
  onInstalled?: () => void
  /**
   * 「打开官方插件市场」——浏览/搜索仍归官方「发现」页。
   *
   * 三级降级全拿不到时父组件传 `undefined`，这一行按钮就不渲染（不做一个点了没反应的按钮）。
   */
  openMarket?: () => void
}

/**
 * 结果区（纯展示）。
 *
 * 单独导出是为了让 SSR 冒烟能逐个分支渲染：真正的状态机在 `PluginInstallDialog` 里，
 * 而 `renderToStaticMarkup` 不跑 effect、也点不了按钮，只能喂 props。
 */
export interface PluginInstallResultProps {
  t: Translate
  phase: PluginInstallPhase
  /** accepted 分支的检查结果。 */
  inspect: PluginInspectAccepted | null
  /** refused 分支的检查结果。 */
  refused: PluginInspectRefused | null
  /** installing / installed / failed 的安装结果。 */
  result: PluginInstallResponse | null
  /** 需要用户批准才能继续的安装脚本（`pending-builds` 分支）。 */
  pending: string[]
  /** 请求本身失败（503 等）时的一句话；与「官方说装不了」是两回事。 */
  errorText: string | null
  /** 有请求在飞：批准按钮跟着禁用。 */
  busy: boolean
  onApprove: () => void
  /** 本次检查/安装用的原始 spec：检查结果里没有包名时（git / tarball）拿它兜底显示。 */
  spec: string
}
