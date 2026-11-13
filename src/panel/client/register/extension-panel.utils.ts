import type { SessionCreator, SessionListSnapshot, WorkspaceListItem, WorkspaceListSnapshot } from './extension-panel.types'

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
 * 「打开官方插件页」的入口（＝「插件市场」按钮的行为）。
 *
 * 降级顺序即语义，任何一步拿不到都静默降级、绝不抛：
 *   1. `ctx.get('pluginNavigation').openList()` —— 官方 entry-customization 用的正规入口
 *      （比 selectPanel 语义化，也能直达某个 bundle 详情）；
 *   2. `ctx.layout.selectPanel('plugins')` —— 官方「插件」页的 main key 恒为字符串 `plugins`；
 *   3. 都拿不到 → `undefined`，调用方**不渲染**按钮。
 *
 * 为什么包 try/catch：`selectPanel` 在对端没注册这个 main 面板时会抛错（ui-layout 的校验），
 * 而这里的调用点在点击回调里——抛出去只变成一条未捕获弹栈，用户看不到任何解释。
 */
export function openMarketLauncherOf(ctx: unknown): (() => void) | undefined {
  const navigation = readService(ctx, 'pluginNavigation')
  const openList = readMember(navigation, 'openList')
  if (openList !== undefined)
    return () => invokeQuietly('pluginNavigation.openList', () => openList.call(navigation))

  const layout = readService(ctx, 'layout')
  const selectPanel = readMember(layout, 'selectPanel')
  if (selectPanel === undefined)
    return undefined
  // 探到「官方插件页没注册」就不给按钮（否则是个点了没反应的死按钮）；探不到时照旧给，
  // 由 invokeQuietly 兜住抛错——宁可静默失败，也不要少一个本来能用的入口。
  if (mainPanelRegistered(ctx) === false)
    return undefined
  return () => invokeQuietly('layout.selectPanel(plugins)', () => selectPanel.call(layout, 'plugins'))
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
