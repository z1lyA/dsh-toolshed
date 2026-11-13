import type { PluginRowView } from '../apis/index.type'
import type { Translate } from '../locales/index.types'

export interface PluginsTabProps {
  t: Translate
  /**
   * 「插件市场」入口。
   *
   * 由 register 层用 `ctx` 实现（组件本身不碰 ctx：SSR 冒烟拿不到上下文）。
   * 三级降级全拿不到时传 `undefined` —— 按钮**不渲染**，而不是渲染一个点了没反应的按钮。
   */
  openMarket?: () => void
}

export interface PluginRowItemProps {
  t: Translate
  row: PluginRowView
  busy: boolean
  onToggle: (row: PluginRowView) => void
}

/** 撤销记录：只保留最近一次变更。`previousEnabled` 是要回滚到的那一侧。 */
export interface PluginUndoRecord {
  entryId: string
  moduleName: string
  previousEnabled: boolean
}
