import type { SidebarRowLike, SidebarRowSnapshot } from './sidebar-tweaks'
import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_HIDDEN_ATTRIBUTE,
  SIDEBAR_MORE_SELECTOR,
  SIDEBAR_PANELLIST_ANCHOR,
  SIDEBAR_PANELLIST_NAV_SELECTOR,
  SIDEBAR_ROW_SELECTOR,
} from '../constants'
import {
  concealSidebarRows,
  countPanelRows,
  findPanellistNav,
  findSidebarRowTargets,
  resolveSlotLabel,
  restoreSidebarRows,
  shouldConcealMore,
  sidebarTweaksFeature,
} from './sidebar-tweaks'

/**
 * 侧栏 DOM 补丁的可测部分。
 *
 * 这套补丁依赖三条非公开 DOM 约定（`aria-label` 认行 / `aria-haspopup="menu"` 认「更多」/
 * 两者同属装 `[data-slot="sidebar.panellist"]` 的 nav），升级后可能失效。因此这里用最小 DOM
 * 替身把两条契约钉死：**命中 0 个什么都不做**（fail-open），**命中就 display:none 且能逐字恢复**。
 * 真浏览器行为（React 重挂、语言切换）由 MutationObserver 那层负责，见文件头注释。
 */

interface FakeStyle {
  getPropertyValue: (property: string) => string
  getPropertyPriority: (property: string) => string
  setProperty: (property: string, value: string, priority?: string) => void
  removeProperty: (property: string) => void
}

interface FakeButton extends SidebarRowLike {
  attributes: Record<string, string>
  getAttribute: (name: string) => string | null
  style: FakeStyle
  isConnected: boolean
}

function fakeStyle(initial: Record<string, string> = {}): FakeStyle {
  const properties = new Map<string, { priority: string, value: string }>()
  for (const [key, value] of Object.entries(initial))
    properties.set(key, { priority: '', value })
  return {
    getPropertyValue: property => properties.get(property)?.value ?? '',
    getPropertyPriority: property => properties.get(property)?.priority ?? '',
    setProperty: (property, value, priority = '') => {
      properties.set(property, { priority, value })
    },
    removeProperty: (property) => {
      properties.delete(property)
    },
  }
}

function fakeButton(label: string, initialDisplay?: string): FakeButton {
  const attributes: Record<string, string> = { 'aria-label': label }
  return {
    attributes,
    getAttribute: name => attributes[name] ?? null,
    isConnected: true,
    removeAttribute: (name) => {
      delete attributes[name]
    },
    setAttribute: (name, value) => {
      attributes[name] = value
    },
    style: fakeStyle(initialDisplay === undefined ? {} : { display: initialDisplay }),
  }
}

/** 只实现被补丁用到的查询面：`nav` → 详情见下；`button` → 行。 */
function fakeNav(buttons: FakeButton[], options: { anchor?: boolean, more?: FakeButton | null, children?: unknown[] } = {}) {
  return {
    children: options.children ?? [],
    querySelector: (selector: string) => {
      if (selector === SIDEBAR_PANELLIST_ANCHOR)
        return options.anchor === false ? null : {}
      if (selector === SIDEBAR_MORE_SELECTOR)
        return options.more ?? null
      return null
    },
    querySelectorAll: (selector: string) => (selector === SIDEBAR_ROW_SELECTOR ? buttons : []),
  }
}

/** 一个面板行子元素：不是「更多」，但含行按钮。 */
function fakeRowChild(): unknown {
  return { querySelector: (selector: string) => (selector === SIDEBAR_MORE_SELECTOR ? null : {}) }
}

/** 「更多」的那个子元素：含 `aria-haspopup="menu"`，数行时必须跳过。 */
function fakeMoreChild(): unknown {
  return { querySelector: (selector: string) => (selector === SIDEBAR_MORE_SELECTOR ? {} : null) }
}

function fakeDocument(navs: unknown[]) {
  return {
    querySelectorAll: (selector: string) => (selector === SIDEBAR_PANELLIST_NAV_SELECTOR ? navs : []),
  } as unknown as Parameters<typeof findSidebarRowTargets>[0]
}

describe('resolveSlotLabel', () => {
  it('accepts both label shapes the slot API allows', () => {
    expect(resolveSlotLabel('插件')).toBe('插件')
    expect(resolveSlotLabel(() => 'Plugins')).toBe('Plugins')
  })

  it('reports absence instead of hiding a row on a guess', () => {
    expect(resolveSlotLabel(undefined)).toBeUndefined()
    expect(resolveSlotLabel('')).toBeUndefined()
    expect(resolveSlotLabel('   ')).toBeUndefined()
    expect(resolveSlotLabel(() => { throw new Error('slot disposed') })).toBeUndefined()
  })
})

describe('findSidebarRowTargets', () => {
  it('fails open when no nav hosts the panellist slot', () => {
    expect(findPanellistNav(fakeDocument([fakeNav([], { anchor: false })]))).toBeNull()
    expect(findSidebarRowTargets(fakeDocument([]), '插件', true)).toEqual([])
  })

  it('finds the plugins row by its runtime label and the More row by its semantic selector', () => {
    const pluginsRow = fakeButton('插件')
    const toolshedRow = fakeButton('工具管理')
    const moreRow = fakeButton('更多')
    const nav = fakeNav([pluginsRow, toolshedRow], { more: moreRow })

    const targets = findSidebarRowTargets(fakeDocument([nav]), '插件', true)
    expect(targets).toEqual([pluginsRow, moreRow])
    // 自己的「工具管理」行永远不命中：按 id='plugins' 反查出的 label 做全等匹配
    expect(targets).not.toContain(toolshedRow)
  })

  it('still hides More when the plugins label cannot be resolved', () => {
    const moreRow = fakeButton('更多')
    const nav = fakeNav([fakeButton('插件')], { more: moreRow })
    expect(findSidebarRowTargets(fakeDocument([nav]), undefined, true)).toEqual([moreRow])
  })

  it('leaves More alone when an entry has been unpinned (it is the only way back)', () => {
    const pluginsRow = fakeButton('插件')
    const moreRow = fakeButton('更多')
    const nav = fakeNav([pluginsRow], { more: moreRow })

    // 「插件」行照旧藏（它是官方写死常驻的，取消固定对它无效），但「更多」必须留着
    expect(findSidebarRowTargets(fakeDocument([nav]), '插件', false)).toEqual([pluginsRow])
  })

  it('does not hide anything when the label matches no row', () => {
    const nav = fakeNav([fakeButton('Toolshed')], { more: null })
    expect(findSidebarRowTargets(fakeDocument([nav]), '插件', true)).toEqual([])
  })

  it('takes the first match only and reports when several rows match', () => {
    const first = fakeButton('插件')
    const second = fakeButton('插件')
    const reports: string[] = []
    const targets = findSidebarRowTargets(fakeDocument([fakeNav([first, second])]), '插件', true, message => reports.push(message))

    expect(targets).toEqual([first])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('2 sidebar rows match')
  })
})

/**
 * 「更多」的条件隐藏是防「把入口关在门后」的唯一机制。
 *
 * 官方的行过滤是 `id === 'plugins' || !hasEntryActions || !unpinned.includes(id)`，被取消固定的入口
 * 只出现在「更多」菜单里并能在那儿重新固定；所以数错一个就会让用户找不回入口。
 */
describe('countPanelRows / shouldConcealMore', () => {
  it('counts row children of the nav and skips the More one', () => {
    const nav = fakeNav([], { children: [fakeRowChild(), fakeRowChild(), fakeMoreChild()] })
    expect(countPanelRows(nav as unknown as Element)).toBe(2)
  })

  it('counts nothing when the nav has no children (fail-open, keeps More)', () => {
    expect(countPanelRows(fakeNav([]) as unknown as Element)).toBe(0)
  })

  it('hides More only when every registered panel still has a row', () => {
    expect(shouldConcealMore(4, 4)).toBe(true)
    expect(shouldConcealMore(5, 4)).toBe(true)
    // 少一行 = 有入口被取消固定：More 必须留着当回收口
    expect(shouldConcealMore(3, 4)).toBe(false)
  })

  it('keeps More when the registered count cannot be read', () => {
    expect(shouldConcealMore(4, undefined)).toBe(false)
    expect(shouldConcealMore(0, 0)).toBe(false)
  })
})

describe('conceal / restore', () => {  it('hides with !important and restores the original inline value verbatim', () => {
    const unstyled = fakeButton('插件')
    const styled = fakeButton('更多', 'flex')
    const previous = new Map<SidebarRowLike, SidebarRowSnapshot>()

    concealSidebarRows([unstyled, styled], previous)
    for (const row of [unstyled, styled]) {
      expect(row.style.getPropertyValue('display')).toBe('none')
      expect(row.style.getPropertyPriority('display')).toBe('important')
      expect(row.attributes[SIDEBAR_HIDDEN_ATTRIBUTE]).toBe('true')
    }

    restoreSidebarRows(previous)
    expect(unstyled.style.getPropertyValue('display')).toBe('')
    expect(styled.style.getPropertyValue('display')).toBe('flex')
    expect(styled.attributes[SIDEBAR_HIDDEN_ATTRIBUTE]).toBeUndefined()
    expect(previous.size).toBe(0)
  })

  it('keeps the first snapshot when reconcile runs repeatedly (no self-overwrite)', () => {
    const row = fakeButton('插件', 'inline-flex')
    const previous = new Map<SidebarRowLike, SidebarRowSnapshot>()

    concealSidebarRows([row], previous)
    concealSidebarRows([row], previous)
    restoreSidebarRows(previous)

    expect(row.style.getPropertyValue('display')).toBe('inline-flex')
  })

  it('does nothing when nothing is matched', () => {
    const previous = new Map<SidebarRowLike, SidebarRowSnapshot>()
    concealSidebarRows([], previous)
    expect(previous.size).toBe(0)
    expect(() => restoreSidebarRows(previous)).not.toThrow()
  })
})

describe('sidebarTweaksFeature', () => {
  it('is an effect function the client entry can hand to ctx.effect', () => {
    expect(typeof sidebarTweaksFeature).toBe('function')
  })
})
