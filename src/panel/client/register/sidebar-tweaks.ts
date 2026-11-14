import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import {
  SIDEBAR_HIDDEN_ATTRIBUTE,
  SIDEBAR_MAIN_SLOT,
  SIDEBAR_MORE_SELECTOR,
  SIDEBAR_PANELLIST_ANCHOR,
  SIDEBAR_PANELLIST_NAV_SELECTOR,
  SIDEBAR_PANELLIST_SLOT,
  SIDEBAR_PLUGINS_ENTRY_ID,
  SIDEBAR_ROW_SELECTOR,
} from '../constants'

/**
 * 隐藏侧栏自带的「插件」行、并在「没有入口被取消固定」时顺带藏掉「更多」。
 *
 * 为什么只能改 DOM（spike-client §3）：`ctx.slots` 的注册项没有 `when/hidden/disabled`，
 * `registrant` 只是诊断标签，disposer 归注册者、不能反注册别人的条目；pins 那条路还被官方
 * 双层写死（`setPinned` 对 `id === 'plugins'` 直接 return，行过滤又把它排除在 unpinned 之外）。
 * 所以照 `vendor-archive/.../register/obstructions.ts` 的既有做法：先存原值、再
 * `setProperty('display','none','important')`，dispose 时逐字恢复。
 *
 * **「更多」不能无条件藏**（用户已经踩过一次）：官方 sidebar 的行过滤是
 * `id === 'plugins' || !hasEntryActions || !unpinned.includes(id)`，被取消固定的入口**只出现在
 * 「更多」菜单里**并可在那里重新固定。藏掉「更多」= 把入口关在门后，而固定状态是**内存态**
 * （刷新才回来）。因此这里的规则是：只有当「渲染出来的行数 ≥ 已注册的面板数」——也就是一个都没被
 * 取消固定——才藏；一旦有入口不见了，「更多」自动重新出现，保证永远有回收口。
 *
 * 全程 fail-open：定位不到 / 数不出来就什么都不做。最坏结果是「藏不掉」，绝不会炸页面。
 */

/** 隐藏逻辑真正用到的 style 面（单测用同形替身即可覆盖 fail-open 与恢复）。 */
export interface SidebarRowStyleLike {
  getPropertyValue: (property: string) => string
  getPropertyPriority: (property: string) => string
  setProperty: (property: string, value: string, priority?: string) => void
  removeProperty: (property: string) => void
}

export interface SidebarRowLike {
  style: SidebarRowStyleLike
  setAttribute: (name: string, value: string) => void
  removeAttribute?: (name: string) => void
  /** React 重挂后旧节点会脱离文档：这类记录不再需要恢复，reconcile 时顺手清掉。 */
  isConnected?: boolean
}

export interface SidebarRowSnapshot {
  displayValue: string
  displayPriority: string
}

type Report = (message: string, detail?: unknown) => void

/**
 * 槽条目的 label 解析。
 *
 * 官方 `SlotLabel` 允许字符串或函数（ui-sidebar 自己也是 `typeof label === 'function' ? label() : label`），
 * 所以这里不写死「插件 / Plugins」——语言有 8 种，写死任何一种都会在切换语言后藏不掉。
 */
export function resolveSlotLabel(label: unknown): string | undefined {
  let value: unknown
  try {
    value = typeof label === 'function' ? (label as () => unknown)() : label
  }
  catch {
    return undefined
  }
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * 装 `sidebar.panellist` 的那个 nav。
 *
 * `data-slot` 是 renderer 的对外输出，比构建哈希类名（`wtg9ga_*`）稳；但它每行都有同一个值，
 * 只能用来**认 nav**，不能用来认行，也不能用 nth-child。
 */
export function findPanellistNav(root: Pick<Document, 'querySelectorAll'>): Element | null {
  for (const nav of root.querySelectorAll(SIDEBAR_PANELLIST_NAV_SELECTOR)) {
    if (nav.querySelector(SIDEBAR_PANELLIST_ANCHOR) !== null)
      return nav
  }
  return null
}

/**
 * 数一数 nav 里到底渲染了几个面板行。
 *
 * 判断依据是结构而不是类名：每个面板行是 nav 的一个**子元素**（官方 `PanelRow` 外面那层 div），
 * 而「更多」是唯一含 `aria-haspopup="menu"` 的那个子元素——跳过它，剩下的就是行。
 * 这样不依赖 `wtg9ga_*` 这类构建哈希类名，也不数按钮（每行还带一个取消固定的 aria-label 按钮）。
 */
export function countPanelRows(nav: Element): number {
  let count = 0
  for (const child of Array.from(nav.children)) {
    if (child.querySelector(SIDEBAR_MORE_SELECTOR) !== null)
      continue
    if (child.querySelector(SIDEBAR_ROW_SELECTOR) !== null)
      count += 1
  }
  return count
}

/**
 * 「更多」能不能藏。
 *
 * 只有渲染出来的行数 ≥ 已注册的面板数（= 没有任何入口被取消固定）时才藏。
 * 拿不到注册数就**不藏**：这是 fail-open 里安全的那一侧——多一行「更多」只是碍眼，
 * 少了它就是入口找不回来。
 */
export function shouldConcealMore(rowCount: number, registeredCount: number | undefined): boolean {
  if (registeredCount === undefined || registeredCount <= 0)
    return false
  return rowCount >= registeredCount
}

/**
 * 要隐藏的目标：官方「插件」行（按运行时反查出来的 label **全等**匹配），以及按条件藏的「更多」。
 *
 * 命中 0 个返回空数组（fail-open）；同一目标命中多个时只取第一个并告警，不做批量隐藏
 * ——多命中通常意味着官方 DOM 变了，批量隐藏有误伤风险。
 */
export function findSidebarRowTargets(
  root: Pick<Document, 'querySelectorAll'>,
  pluginLabel: string | undefined,
  concealMore: boolean,
  report?: Report,
): HTMLElement[] {
  const nav = findPanellistNav(root)
  if (nav === null)
    return []

  const targets: HTMLElement[] = []
  if (pluginLabel !== undefined) {
    const rows = nav.querySelectorAll(SIDEBAR_ROW_SELECTOR)
    const matched = Array.from(rows).filter(row => row.getAttribute('aria-label') === pluginLabel)
    if (matched.length > 1)
      report?.(`[dsh-toolshed] ${matched.length} sidebar rows match the plugins label; hiding the first only`, { pluginLabel })
    if (matched.length > 0)
      targets.push(matched[0] as HTMLElement)
  }

  if (concealMore) {
    const more = nav.querySelector(SIDEBAR_MORE_SELECTOR)
    if (more !== null)
      targets.push(more as HTMLElement)
  }

  return targets
}

/** 幂等隐藏：第一次命中时先记住原有 inline display，`dispose` 时按记录逐字恢复。 */
export function concealSidebarRows(targets: readonly SidebarRowLike[], previous: Map<SidebarRowLike, SidebarRowSnapshot>): void {
  for (const target of targets) {
    if (!previous.has(target)) {
      previous.set(target, {
        displayValue: target.style.getPropertyValue('display'),
        displayPriority: target.style.getPropertyPriority('display'),
      })
    }
    target.style.setProperty('display', 'none', 'important')
    // 复查用标记：DevTools 里一眼看出这行是被本插件补丁藏掉的。
    target.setAttribute(SIDEBAR_HIDDEN_ATTRIBUTE, 'true')
  }
}

export function restoreSidebarRows(previous: Map<SidebarRowLike, SidebarRowSnapshot>): void {
  for (const [target, snapshot] of previous) {
    if (snapshot.displayValue !== '')
      target.style.setProperty('display', snapshot.displayValue, snapshot.displayPriority)
    else
      target.style.removeProperty('display')
    if (target.removeAttribute !== undefined)
      target.removeAttribute(SIDEBAR_HIDDEN_ATTRIBUTE)
    else
      target.setAttribute(SIDEBAR_HIDDEN_ATTRIBUTE, 'false')
  }
  previous.clear()
}

export const sidebarTweaksFeature = defineRegister<ClientContext>((controller, ctx) => {
  if (typeof document === 'undefined')
    return

  const previous = new Map<SidebarRowLike, SidebarRowSnapshot>()
  // -1 而不是 0：首次 reconcile 命中 0 个也要打一行，便于确认「是 0 命中而不是没跑」。
  let reportedCount = -1

  const report: Report = (message, detail) => {
    if (detail === undefined)
      console.debug(message)
    else
      console.debug(message, detail)
  }

  /** 每次 reconcile 都重新按当前语言解析标签：语言一切换，旧标签就匹配不到了。 */
  const resolvePluginLabel = (): string | undefined => {
    try {
      // 槽条目是各 kind 的联合类型，这里只读 `id` / `label` 两个公共字段，用窄面断言避免按 kind 收窄。
      const entries = (ctx.slots?.entriesOfSlot?.(SIDEBAR_PANELLIST_SLOT) ?? []) as { options?: { id?: unknown, label?: unknown } }[]
      const entry = entries.find(candidate => candidate?.options?.id === SIDEBAR_PLUGINS_ENTRY_ID)
      return resolveSlotLabel(entry?.options?.label)
    }
    catch {
      // 半初始化 / 卸载中的槽服务可能抛：拿不到「插件」行标签就只藏「更多」，不升级成错误。
      return undefined
    }
  }

  /**
   * 已注册的面板数（= 侧栏本该有的行数）。
   *
   * 用 `main` 槽的条目数：侧栏的行就是从这份元数据投影出来的，行数少了只可能是因为有入口被取消固定。
   * 读不到就返回 undefined，`shouldConcealMore` 会据此保守地不藏「更多」。
   */
  const countRegisteredPanels = (): number | undefined => {
    try {
      const entries = ctx.slots?.entriesOfSlot?.(SIDEBAR_MAIN_SLOT)
      return Array.isArray(entries) ? entries.length : undefined
    }
    catch {
      return undefined
    }
  }

  const reconcile = (): void => {
    if (controller.isDisposed())
      return

    for (const element of [...previous.keys()]) {
      if (element.isConnected === false)
        previous.delete(element)
    }

    const label = resolvePluginLabel()
    // 「更多」要按当前行数现算：刚取消固定一个入口时，它必须立刻回来当回收口。
    const nav = findPanellistNav(document)
    const concealMore = nav === null
      ? false
      : shouldConcealMore(countPanelRows(nav), countRegisteredPanels())
    const targets = findSidebarRowTargets(document, label, concealMore, report)
    if (targets.length !== reportedCount) {
      reportedCount = targets.length
      report(`[dsh-toolshed] sidebar rows hidden: ${targets.length}`, { plugins: label, concealMore })
    }
    concealSidebarRows(targets, previous)
  }

  controller.observe(document.documentElement, () => reconcile(), {
    childList: true,
    subtree: true,
    // aria-label 变化＝语言切换或官方重渲染：必须重算，否则换语言后按旧标签找不到这一行。
    attributes: true,
    attributeFilter: ['aria-label', 'data-slot'],
  })
  controller.add(() => restoreSidebarRows(previous))
  reconcile()
})
