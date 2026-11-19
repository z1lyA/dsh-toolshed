import type { LocalizedTextView, PluginBundleView } from '../apis/index.type'
import type { Translate } from '../locales/index.types'

/**
 * 本地化文案的解析器：由 register 层注入 `text => ctx.locale.resolveText(text)`。
 *
 * 组件本身不碰 ctx（SSR 冒烟里没有上下文），也**不自己选语言**——`LocalizedText` 可能是
 * 字面量、也可能是按语言 id 索引的映射，选哪一门属于运行时（活跃语言）的事。
 */
export type ResolveLocalizedText = (text: LocalizedTextView) => string

/** 三档筛选：默认「第三方」（官方包淹掉清单，而用户要管的就是第三方那几个）。 */
export type PluginFilter = 'third-party' | 'official' | 'all'

export interface PluginsTabProps {
  t: Translate
  /**
   * 「插件市场」入口。
   *
   * 由 register 层用 `ctx` 实现（组件本身不碰 ctx：SSR 冒烟拿不到上下文）。
   * 三级降级全拿不到时传 `undefined` —— 按钮**不渲染**，而不是渲染一个点了没反应的按钮。
   */
  openMarket?: () => void
  /** 包标题 / 简介的解析器；缺席时组件退回 `en`（见 `localizedTextOf`）。 */
  resolveText?: ResolveLocalizedText
}

export interface PluginBundleCardProps {
  t: Translate
  bundle: PluginBundleView
  resolveText?: ResolveLocalizedText
  busy: boolean
  /**
   * 有可用更新时的徽标数据（`0.6.4 → 0.6.5`）。
   *
   * `undefined` = 这一行**不渲染**更新入口：`link:` 本地依赖与 git 依赖都不该出现一个点了没用的按钮。
   */
  update?: { from?: string, to: string }
  /** 这一行正在更新中（按钮变成「更新中…」，开关同时禁用）。 */
  updating?: boolean
  onToggleBundle: (bundle: PluginBundleView) => void
  /** 用户点了「更新到 x.y.z」：由页面弹确认，真正的执行也在页面里。 */
  onUpdate?: (bundle: PluginBundleView, version: string) => void
}

/**
 * 撤销记录：只保留最近一次**包级**变更。
 *
 * 行级启停已随条目列表一起移除（2.3.0），所以这里不再需要 `kind` 判别——只有一种反向调用，
 * 少一个字段就少一种「记录了却回滚到别的接口」的可能。
 */
export interface PluginUndoRecord {
  /** 包名，反向调用 `postPluginBundleToggle` 用它定位。 */
  name: string
  /** banner 上展示用的名字。 */
  label: string
  /** 要回滚到的那一侧。 */
  previousEnabled: boolean
}
