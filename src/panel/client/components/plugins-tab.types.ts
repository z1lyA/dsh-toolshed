import type { LocalizedTextView, PluginBundleRowView, PluginBundleView } from '../apis/index.type'
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
  /** 展开状态由列表持有（同一时刻可以展开多个包，不能放进卡片内部 state）。 */
  expanded: boolean
  onToggleExpanded: () => void
  onToggleBundle: (bundle: PluginBundleView) => void
  onToggleRow: (row: PluginBundleRowView) => void
}

export interface PluginRowItemProps {
  t: Translate
  row: PluginBundleRowView
  busy: boolean
  onToggle: (row: PluginBundleRowView) => void
}

/**
 * 撤销记录：只保留最近一次变更，包级与行级共用一份。
 *
 * `kind` + `id` 而不是 v1 的单个 `entryId`：包级要回滚的是包名、行级是 Loader 条目 id，
 * 两者的反向调用是不同的接口。
 */
export interface PluginUndoRecord {
  kind: 'bundle' | 'row'
  /** 包名（bundle）或 Loader 条目 id（row）。 */
  id: string
  /** 展示用的短名：包名，或省略 `@deepseek-ai/` 前缀的模块名。 */
  label: string
  /** 要回滚到的那一侧。 */
  previousEnabled: boolean
}
