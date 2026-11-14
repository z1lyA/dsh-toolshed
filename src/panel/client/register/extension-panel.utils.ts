import type { ResolveLocalizedText } from '../components/plugins-tab.types'
import type { SessionCreator, SessionListSnapshot, WorkspaceListItem, WorkspaceListSnapshot } from './extension-panel.types'
import {
  DISCOVER_TAB_POLL_ATTEMPTS,
  DISCOVER_TAB_POLL_INTERVAL_MS,
  PLUGINS_DISCOVER_TAB_ID,
  PLUGINS_TAB_SLOT,
  TABLIST_SELECTOR,
} from '../constants'
import { resolveSlotLabel } from './sidebar-tweaks'

function workspaceId(item: WorkspaceListItem): string | undefined {
  return item.workspaceId ?? item.id
}

export function sessionSnapshotOf(value: unknown): SessionListSnapshot {
  if (typeof value !== 'object' || value === null)
    return { ids: [] }
  const snapshot = value as Record<string, unknown>
  return {
    ...(typeof snapshot.current === 'string' ? { current: snapshot.current } : {}),
    ids: Array.isArray(snapshot.ids) ? snapshot.ids.filter((id): id is string => typeof id === 'string') : [],
  }
}

export function workspaceSnapshotOf(value: unknown): WorkspaceListSnapshot {
  if (typeof value !== 'object' || value === null)
    return {}
  const snapshot = value as Record<string, unknown>
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.filter((item: unknown): item is WorkspaceListItem => typeof item === 'object' && item !== null)
    : undefined
  return {
    ...(items !== undefined ? { items } : {}),
    ...(typeof snapshot.recentWorkspaceId === 'string' ? { recentWorkspaceId: snapshot.recentWorkspaceId } : {}),
  }
}

/**
 * 会话列表快照里的「当前会话」。
 *
 * 核心各代的落点不一致（见 adapter 的 `sessions:current-projection`）：0.1.6 起核心不再把选中态
 * 写进列表快照，改由 `uiSession.adapter.current` 持有，适配层把它投影回 `current`；
 * 部分布局只暴露若干别名。字段名逐个候选，拿不到就诚实返回 undefined——
 * 「当前会话所属工作区」这个判断不能用一个猜出来的 id 去做。
 */
export function currentSessionIdOf(snapshot: unknown): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null)
    return undefined
  const record = snapshot as Record<string, unknown>
  for (const key of ['current', 'currentSessionId', 'activeSessionId', 'selectedSessionId', 'recentSessionId', 'lastSessionId']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '')
      return value
  }
  return undefined
}

/** 列表末项＝最近活跃的一条（`ids` 由核心按活跃度排序）。 */
export function lastSessionIdOf(snapshot: unknown): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null)
    return undefined
  const ids = (snapshot as Record<string, unknown>).ids
  if (!Array.isArray(ids))
    return undefined
  const live = ids.filter((id): id is string => typeof id === 'string' && id !== '')
  return live.length > 0 ? live[live.length - 1] : undefined
}

/**
 * 兜底会话：只在「新建不出会话」的退级路径上用（见 `extension-panel.tsx` 的 `createSkill`）。
 *
 * 技能创建器只需要一个有输入框承载草稿的会话，所以选择态优先、最近活跃兜底。
 */
export function pickSessionId(snapshot: unknown): string | undefined {
  return currentSessionIdOf(snapshot) ?? lastSessionIdOf(snapshot)
}

/**
 * `sessions.create` 的能力探测。
 *
 * 适配层的 `AdapterSessions` 只承诺投影面（`list` / `open`…），新建会话是官方服务的原生成员，
 * 按能力取用：旧核心没有它时返回 undefined，由调用方退级，而不是抛一个 `not a function`。
 */
export function sessionCreatorOf(sessions: unknown): SessionCreator | undefined {
  if (sessions === null || typeof sessions !== 'object')
    return undefined
  const create = (sessions as { create?: unknown }).create
  return typeof create === 'function' ? sessions as SessionCreator : undefined
}

/** 会话摘要里本工具读的字段（`sessions.list` 快照的 `byId` 行）。 */
export function sessionCwdOf(snapshot: unknown, sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || snapshot === null || typeof snapshot !== 'object')
    return undefined
  const byId = (snapshot as Record<string, unknown>).byId
  if (byId === null || typeof byId !== 'object')
    return undefined
  const summary = (byId as Record<string, unknown>)[sessionId]
  if (summary === null || typeof summary !== 'object')
    return undefined
  const cwd = (summary as Record<string, unknown>).cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** 「新建技能」要用的服务面：适配后的会话服务 + `connectWorkspace`（第二级退级）。 */
export interface SkillSessionSource {
  sessions?: unknown
  connectWorkspace?: (workspaceId: string) => unknown
}

/** 调用官方 `sessions.create`，把「没这个能力」与「返回了非 id」都收敛成 undefined。 */
async function createSession(
  creator: SessionCreator | undefined,
  options: { workspaceId?: string, cwd?: string },
): Promise<string | undefined> {
  if (creator === undefined)
    return undefined
  const created = await creator.create(options)
  return typeof created === 'string' && created !== '' ? created : undefined
}

/**
 * 为技能创建器开一条会话，返回它的 id。
 *
 * 退级顺序即语义：
 *   1. `sessions.create({ workspaceId })` —— 0.1.7 官方入口，**在工作区目录下新建**一条对话，
 *      并在 resolve 前把这一行发布进会话目录，所以返回值可以立刻拿去预填
 *      （核心 `dsh-client-ui-workspace` 的 `reuseOrCreateBlank` 走的也是它）；
 *   2. `workspaces.connectWorkspace(workspaceId)` —— 上游写法（`uiWorkspace.connectWorkspace`，
 *      由适配层的 legacy 迁移投影回 `workspaces`）。它**可能复用**该工作区里已有的空白会话；
 *   3. 当前会话不属于任何工作区时（桌面壳的「未分组」），用它的 `cwd` 建会话——同样在当前目录；
 *   4. 以上都拿不到（核心更旧、没有工作区也没有 cwd）才复用活跃会话，保证按钮点了仍有草稿可写。
 *
 * 前几级的失败照原样抛出，不吞成最后一级：那是「明明能新建却失败」，值得让面板把原因显示出来，
 * 而不是静默退回复用，把用户的对话抢走（这正是 1.0.3 起那一版的毛病）。
 */
export async function createSkillSession(
  source: SkillSessionSource,
  workspaceId: string | undefined,
  sessionSnapshot: unknown,
): Promise<string | undefined> {
  const creator = sessionCreatorOf(source.sessions)
  if (workspaceId !== undefined) {
    const inWorkspace = await createSession(creator, { workspaceId })
    if (inWorkspace !== undefined)
      return inWorkspace
    const connected = await source.connectWorkspace?.(workspaceId)
    if (typeof connected === 'string' && connected !== '')
      return connected
  }
  else {
    const cwd = sessionCwdOf(sessionSnapshot, currentSessionIdOf(sessionSnapshot))
    if (cwd !== undefined) {
      const inDirectory = await createSession(creator, { cwd })
      if (inDirectory !== undefined)
        return inDirectory
    }
  }
  return pickSessionId(sessionSnapshot)
}

export function chooseWorkspace(
  sessions: SessionListSnapshot,
  workspaces: WorkspaceListSnapshot,
): string | undefined {
  const items = workspaces.items ?? []
  const current = sessions.current
  const currentItem = current === undefined
    ? undefined
    : items.find(item => item.sessionIds?.includes(current))
  const currentId = currentItem === undefined ? undefined : workspaceId(currentItem)
  if (currentId !== undefined)
    return currentId
  if (workspaces.recentWorkspaceId !== undefined && items.some(item => workspaceId(item) === workspaces.recentWorkspaceId))
    return workspaces.recentWorkspaceId
  return items.map(workspaceId).find((id): id is string => id !== undefined)
}

/**
 * 本地化文案解析器（`ctx.locale.resolveText`）：类型面在组件 props 里，这里只负责按能力探查。
 *
 * 契约要求组件**不自己选语言**：`LocalizedText` 要么是字面量、要么是按语言 id 索引的映射，
 * 选哪一门由运行时的活跃语言决定。这个成员在类型面里不保证存在（`LocaleRuntime` 只承诺
 * `text` / `bind`），所以拿不到就返回 undefined，组件用 `en` 兜底而不是整页崩掉。
 */
export function resolveTextOf(ctx: unknown): ResolveLocalizedText | undefined {
  const localeService = readService(ctx, 'locale')
  const resolveText = readMember(localeService, 'resolveText')
  if (resolveText === undefined)
    return undefined
  return (text) => {
    try {
      const resolved = resolveText.call(localeService, text)
      return typeof resolved === 'string' ? resolved : ''
    }
    catch {
      return ''
    }
  }
}

/** 「发现」tab 的定位信息：`tabId` 就是 `plugins.tab` 槽条目的 id（市场注册的是 `discover`）。 */
export interface DiscoverTabTarget {
  tabId: string
  /** 槽条目的 label（字符串或函数求值后）：DOM 里 id 匹配失败时的第二选择器靠它，绝不写死中英文。 */
  label?: string
}

/**
 * 要点的那个 tab：优先 `id === 'discover'`（市场），否则取槽里第一个。
 *
 * 只读槽信息、不碰 DOM：调用点在**渲染期**（register/extension-panel.tsx 每次 render 都探一遍），
 * 而 SSR 冒烟里没有 `document`。
 */
export function discoverTabTargetOf(ctx: unknown): DiscoverTabTarget | undefined {
  const slots = readService(ctx, 'slots')
  const entriesOfSlot = readMember(slots, 'entriesOfSlot')
  if (entriesOfSlot === undefined)
    return undefined
  let entries: unknown
  try {
    entries = entriesOfSlot.call(slots, PLUGINS_TAB_SLOT)
  }
  catch {
    // 半初始化 / 卸载中的槽服务可能抛：拿不到条目就只「打开页面」，不升级成错误。
    return undefined
  }
  if (!Array.isArray(entries) || entries.length === 0)
    return undefined
  // 槽条目是各 kind 的联合，这里只读 `id` / `label` 两个公共字段（与 sidebar-tweaks 同一手法）。
  const rows = entries as { options?: { id?: unknown, label?: unknown } }[]
  const picked = rows.find(row => row?.options?.id === PLUGINS_DISCOVER_TAB_ID) ?? rows[0]
  const tabId = picked?.options?.id
  if (typeof tabId !== 'string' || tabId === '')
    return undefined
  return { tabId, label: resolveSlotLabel(picked?.options?.label) }
}

/** 补丁只用到「能点、能读属性」这两个面，单测给同形替身即可。 */
type TabButtonLike = { click: () => void, getAttribute: (name: string) => string | null }
/** 只用到 document 的两个查询面：单测因此不需要 jsdom。 */
export type TabQueryRoot = Pick<Document, 'querySelector' | 'querySelectorAll'>

function asTabButton(value: unknown): TabButtonLike | undefined {
  if (value === null || value === undefined)
    return undefined
  const candidate = value as Partial<TabButtonLike>
  return typeof candidate.click === 'function' && typeof candidate.getAttribute === 'function'
    ? candidate as TabButtonLike
    : undefined
}

/**
 * 在 DOM 里找那个 tab 按钮。
 *
 * 官方 `SegmentedTabs` 给每个 tab 的 DOM id 是 `${tabsId}-<tabId>`，`tabsId` 来自 `useId()`
 * （不可预知），所以只能用**后缀**匹配；面板的 id 是 `${tabsId}-<tabId>-panel`，不会误命中。
 * 找不到再退到 tablist 里按 label 文本全等匹配（语言由运行时决定，不写死）。
 */
export function findDiscoverTabButton(root: TabQueryRoot, target: DiscoverTabTarget): TabButtonLike | undefined {
  const byId = asTabButton(root.querySelector(`[id$="-${target.tabId}"]`))
  if (byId !== undefined)
    return byId
  if (target.label === undefined)
    return undefined
  for (const tablist of root.querySelectorAll(TABLIST_SELECTOR)) {
    for (const button of tablist.querySelectorAll('button')) {
      if ((button.textContent ?? '').trim() !== target.label)
        continue
      const candidate = asTabButton(button)
      if (candidate !== undefined)
        return candidate
    }
  }
  return undefined
}

/**
 * 点完之后复查：官方 tab 按钮带 `aria-selected`，个别实现用 `data-state`。
 *
 * 两个属性**都不在**时按「已生效」处理：那是这一代 DOM 变了，我们无从判断——谎报失败比不校验更糟。
 */
export function discoverTabActive(button: TabButtonLike): boolean {
  const selected = button.getAttribute('aria-selected')
  if (selected !== null)
    return selected === 'true'
  const state = button.getAttribute('data-state')
  if (state !== null)
    return state === 'active'
  return true
}

export type DiscoverTabOutcome = 'activated' | 'missing' | 'rejected'

export function activateDiscoverTab(
  root: TabQueryRoot,
  target: DiscoverTabTarget,
  report?: (message: string, detail?: unknown) => void,
): DiscoverTabOutcome {
  const button = findDiscoverTabButton(root, target)
  if (button === undefined)
    return 'missing'
  try {
    button.click()
  }
  catch {
    return 'rejected'
  }
  if (discoverTabActive(button))
    return 'activated'
  report?.('[dsh-toolshed] plugins tab did not switch to discover; the page stays on "installed"', { tabId: target.tabId })
  return 'rejected'
}

export interface DiscoverTabPollOptions {
  /** 默认 `document`；单测给替身，SSR / 非浏览器环境直接放弃。 */
  root?: TabQueryRoot
  attempts?: number
  intervalMs?: number
  schedule?: (run: () => void, delayMs: number) => unknown
  report?: (message: string, detail?: unknown) => void
}

/**
 * 打开官方页之后「点发现」的那一步。
 *
 * 为什么轮询：官方页是**刚被 openList() 打开**的，React 还没把它挂上来；100 ms × 30 次
 * 就是给它 3 s 的挂载时间。任何一步失败都静默降级（用户落在「已安装」，仍然可用），
 * 只留一行 console.debug 作为现场诊断——按钮点了没反应是最难查的一类问题。
 */
export function activateDiscoverTabEventually(
  target: DiscoverTabTarget | undefined,
  options: DiscoverTabPollOptions = {},
): void {
  if (target === undefined)
    return
  const root = options.root ?? (typeof document === 'undefined' ? undefined : document)
  if (root === undefined)
    return
  const schedule = options.schedule ?? ((run: () => void, delayMs: number) => setTimeout(run, delayMs))
  const intervalMs = options.intervalMs ?? DISCOVER_TAB_POLL_INTERVAL_MS
  let remaining = Math.max(1, options.attempts ?? DISCOVER_TAB_POLL_ATTEMPTS)

  const tick = (): void => {
    const outcome = activateDiscoverTab(root, target, options.report)
    // 找到按钮就不再用后面的配额：点不动（rejected）是这代 DOM 变了，重试也不会变好。
    if (outcome !== 'missing')
      return
    remaining -= 1
    if (remaining <= 0) {
      options.report?.('[dsh-toolshed] plugins tab never rendered; the market entry stops on "installed"', { tabId: target.tabId })
      return
    }
    schedule(tick, intervalMs)
  }
  // 先等一拍再找：官方页此刻才被点开，立刻查只会白耗一次配额。
  schedule(tick, intervalMs)
}

/**
 * 「插件市场」入口（＝「插件市场」按钮的行为）。
 *
 * 降级顺序即语义，任何一步拿不到都静默降级、绝不抛：
 *   1. `ctx.get('pluginNavigation').openList()` —— 官方 entry-customization 用的正规入口
 *      （比 selectPanel 语义化，也能直达某个 bundle 详情）；
 *   2. `ctx.layout.selectPanel('plugins')` —— 官方「插件」页的 main key 恒为字符串 `plugins`；
 *   3. 都拿不到 → `undefined`，调用方**不渲染**按钮。
 * 页面打开后再补一步「点发现 tab」（见 `activateDiscoverTabEventually`）：官方
 * `pluginNavigation` 没有「打开 discover」的接口，只能走这条 DOM 兜底。
 *
 * 为什么包 try/catch：`selectPanel` 在对端没注册这个 main 面板时会抛错（ui-layout 的校验），
 * 而这里的调用点在点击回调里——抛出去只变成一条未捕获弹栈，用户看不到任何解释。
 */
export function openMarketLauncherOf(ctx: unknown): (() => void) | undefined {
  const target = discoverTabTargetOf(ctx)
  const openDiscover = (): void => activateDiscoverTabEventually(target, { report: debugReport })

  const navigation = readService(ctx, 'pluginNavigation')
  const openList = readMember(navigation, 'openList')
  if (openList !== undefined) {
    return () => {
      invokeQuietly('pluginNavigation.openList', () => openList.call(navigation))
      openDiscover()
    }
  }

  const layout = readService(ctx, 'layout')
  const selectPanel = readMember(layout, 'selectPanel')
  if (selectPanel === undefined)
    return undefined
  // 探到「官方插件页没注册」就不给按钮（否则是个点了没反应的死按钮）；探不到时照旧给，
  // 由 invokeQuietly 兜住抛错——宁可静默失败，也不要少一个本来能用的入口。
  if (mainPanelRegistered(ctx) === false)
    return undefined
  return () => {
    invokeQuietly('layout.selectPanel(plugins)', () => selectPanel.call(layout, 'plugins'))
    openDiscover()
  }
}

function debugReport(message: string, detail?: unknown): void {
  if (detail === undefined)
    console.debug(message)
  else
    console.debug(message, detail)
}

/**
 * 守卫安全的服务读取：`ctx.get(name)` 优先（Cordis 对未声明键的 inject 守卫会抛错），
 * 回退属性读取；任何异常都等同于「服务不存在」。
 */
function readService(ctx: unknown, name: string): unknown {
  if (ctx === null || ctx === undefined)
    return undefined
  const kind = typeof ctx
  if (kind !== 'object' && kind !== 'function')
    return undefined
  const runtime = ctx as { get?: (name: string) => unknown } & Record<string, unknown>
  try {
    return typeof runtime.get === 'function' ? runtime.get(name) : runtime[name]
  }
  catch {
    return undefined
  }
}

/** 取一个可调用的服务成员；缺席或不是函数都返回 undefined（调用方据此降级）。 */
function readMember(owner: unknown, name: string): ((...args: unknown[]) => unknown) | undefined {
  if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function'))
    return undefined
  try {
    const member = (owner as Record<string, unknown>)[name]
    return typeof member === 'function' ? member as (...args: unknown[]) => unknown : undefined
  }
  catch {
    return undefined
  }
}

/** 官方「插件」页是否注册在 `main` 槽；`undefined` = 这代核心探不出来（不是「没注册」）。 */
function mainPanelRegistered(ctx: unknown): boolean | undefined {
  const slots = readService(ctx, 'slots')
  const entriesOfSlot = readMember(slots, 'entriesOfSlot')
  if (entriesOfSlot === undefined)
    return undefined
  try {
    const entries = entriesOfSlot.call(slots, 'main')
    if (!Array.isArray(entries))
      return undefined
    return entries.some(entry => (entry as { options?: { key?: unknown } })?.options?.key === 'plugins')
  }
  catch {
    return undefined
  }
}

function invokeQuietly(label: string, run: () => unknown): void {
  try {
    void run()
  }
  catch (error) {
    console.debug(`[dsh-toolshed] ${label} failed; the market entry stays inert`, error)
  }
}
