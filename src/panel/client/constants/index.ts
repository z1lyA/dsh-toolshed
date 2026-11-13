import type { LocaleKey } from '../locales/index.types'
import { PLUGIN_ID } from '../../shared/constants'

export { PLUGIN_ID } from '../../shared/constants'

export const CONVERSATION_INPUT_LEFT_SLOT = 'conversation.input.left'
export const PANEL_ID = PLUGIN_ID
export const PANEL_ACTION_ORDER = 20
export const INPUT_PREFILL_ID = `${PLUGIN_ID}.skill-prefill`
export const INPUT_PREFILL_ORDER = 40
export const INPUT_PREFILL_PRIORITY = 0
export const STYLE_ID = `${PLUGIN_ID}-styles`

export const LOCALE_EFFECT = `${PLUGIN_ID}: locale`
export const STYLES_EFFECT = `${PLUGIN_ID}: styles`
export const SKILL_CREATOR_PREFILL_EFFECT = `${PLUGIN_ID}: skill creator prefill`
export const EXTENSION_PANEL_EFFECT = `${PLUGIN_ID}: extension panel`
export const SIDEBAR_TWEAKS_EFFECT = `${PLUGIN_ID}: sidebar tweaks`

/**
 * 侧栏两行（官方「插件」/「更多」）的隐藏目标。
 *
 * 为什么是这三个非公开 DOM 约定（spike-client §3.4）：`ctx.slots` 没有 when/hidden，也不能反注册
 * 他人的条目，pins 还把 `plugins` 写死常驻——只有 DOM 兜底一条路。定位一律用语义锚点：
 * `data-slot` 认 nav、`aria-label`（运行时按槽条目 label 反查，不写死中英文）、`aria-haspopup="menu"`
 * 认「更多」；构建哈希类名（`wtg9ga_*`）与 nth-child 一律不用，它们在升级后会静默错位。
 */
export const SIDEBAR_PANELLIST_SLOT = 'sidebar.panellist'
export const SIDEBAR_PLUGINS_ENTRY_ID = 'plugins'
export const SIDEBAR_PANELLIST_ANCHOR = `[data-slot="${SIDEBAR_PANELLIST_SLOT}"]`
export const SIDEBAR_PANELLIST_NAV_SELECTOR = 'nav'
export const SIDEBAR_ROW_SELECTOR = 'button'
export const SIDEBAR_MORE_SELECTOR = 'button[aria-haspopup="menu"]'
export const SIDEBAR_HIDDEN_ATTRIBUTE = 'data-toolshed-hidden'

export const SKILL_CREATOR_DRAFT = '/skill-creator '
export const SKILL_REFRESH_INTERVAL_MS = 300
export const SKILL_REFRESH_TIMEOUT_MS = 5_000
export const IMPORT_REFRESH_DELAYS_MS = [250, 750, 1_500] as const
export const MCP_RESTART_INITIAL_DELAY_MS = 3_000
export const MCP_RESTART_POLL_INTERVAL_MS = 1_500
export const MCP_RESTART_TIMEOUT_MS = 60_000
// 「服务」页重启后的恢复探测：沿用同一组节奏（3 s 首探、1.5 s 间隔、60 s 上限）。
export const SERVICE_RESTART_INITIAL_DELAY_MS = MCP_RESTART_INITIAL_DELAY_MS
export const SERVICE_RESTART_POLL_INTERVAL_MS = MCP_RESTART_POLL_INTERVAL_MS
export const SERVICE_RESTART_TIMEOUT_MS = MCP_RESTART_TIMEOUT_MS
export const GITHUB_REPOSITORY_PATTERN = /^(?:https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+\/?$/i

export const SOURCE_LOCALE_KEYS: Readonly<Record<string, LocaleKey>> = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  'runtime': 'sourceRuntime',
  'bundled': 'sourceBundled',
  'custom': 'sourceCustom',
}
