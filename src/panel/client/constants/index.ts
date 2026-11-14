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
 * 侧栏自带的「插件」行（以及有条件地「更多」）的隐藏目标。
 *
 * 为什么是这些非公开 DOM 约定（spike-client §3.4 + 0.2.2 的 `SidebarRoot`）：`ctx.slots` 没有 when/hidden，
 * 也不能反注册他人的条目，pins 还把 `plugins` 写死常驻——只有 DOM 兜底一条路。定位一律用语义锚点：
 * `data-slot` 认 nav、`aria-label`（运行时按槽条目 label 反查，不写死中英文）、`aria-haspopup="menu"`
 * 认「更多」；构建哈希类名（`wtg9ga_*`）与 nth-child 一律不用，它们在升级后会静默错位。
 *
 * `SIDEBAR_MAIN_SLOT` 只用来数「侧栏本该有几行」：`main` 槽的条目就是侧栏行的来源，行数变少
 * 说明有入口被取消固定，此时「更多」必须留着当回收口。
 */
export const SIDEBAR_PANELLIST_SLOT = 'sidebar.panellist'
export const SIDEBAR_MAIN_SLOT = 'main'
export const SIDEBAR_PLUGINS_ENTRY_ID = 'plugins'
export const SIDEBAR_PANELLIST_ANCHOR = `[data-slot="${SIDEBAR_PANELLIST_SLOT}"]`
export const SIDEBAR_PANELLIST_NAV_SELECTOR = 'nav'
export const SIDEBAR_ROW_SELECTOR = 'button'
export const SIDEBAR_MORE_SELECTOR = 'button[aria-haspopup="menu"]'
export const SIDEBAR_HIDDEN_ATTRIBUTE = 'data-toolshed-hidden'

/**
 * 官方「插件」页的 tab 槽与市场注册的 tab id。
 *
 * 为什么需要这些：官方 `pluginNavigation` 只有 `openList()` / `openBundle()`，两者都把页面强制切到
 * `installed`，**没有**「打开 discover」的接口。市场只是往 `plugins.tab` 注册了一个 `id: 'discover'`
 * 的 tab，所以「跳到发现」只能先打开官方页、再在 DOM 里点那个 tab（见 register/extension-panel.utils.ts）。
 */
export const PLUGINS_TAB_SLOT = 'plugins.tab'
export const PLUGINS_DISCOVER_TAB_ID = 'discover'
/** 官方 `SegmentedTabs` 的 tablist 角色；`[id$="-<tabId>"]` 匹配不到时的第二选择器。 */
export const TABLIST_SELECTOR = '[role="tablist"]'
/** 官方页是点开后才挂载的：100 ms × 30 次 ≈ 3 s，超过就认定「这代 DOM 变了」并静默放弃。 */
export const DISCOVER_TAB_POLL_INTERVAL_MS = 100
export const DISCOVER_TAB_POLL_ATTEMPTS = 30

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
