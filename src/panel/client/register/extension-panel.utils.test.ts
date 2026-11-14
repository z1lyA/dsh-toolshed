import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateDiscoverTab,
  chooseWorkspace,
  createSkillSession,
  currentSessionIdOf,
  discoverTabActive,
  discoverTabTargetOf,
  lastSessionIdOf,
  openMarketLauncherOf,
  pickSessionId,
  resolveTextOf,
  sessionCreatorOf,
  sessionCwdOf,
  sessionSnapshotOf,
  workspaceSnapshotOf,
} from './extension-panel.utils'

describe('currentSessionIdOf', () => {
  it('reads the projected current id', () => {
    expect(currentSessionIdOf({ current: 's-1', ids: ['s-1', 's-2'] })).toBe('s-1')
  })

  it('accepts the alias keys some layouts expose', () => {
    expect(currentSessionIdOf({ activeSessionId: 's-2' })).toBe('s-2')
  })

  it('stays undefined without a selection instead of guessing the last row', () => {
    expect(currentSessionIdOf({ ids: ['s-1', 's-2'] })).toBeUndefined()
    expect(currentSessionIdOf({ current: '' })).toBeUndefined()
    expect(currentSessionIdOf(null)).toBeUndefined()
  })
})

describe('lastSessionIdOf', () => {
  it('takes the most recently active row', () => {
    expect(lastSessionIdOf({ ids: ['s-1', 's-2'] })).toBe('s-2')
  })

  it('ignores empty ids and non-list snapshots', () => {
    expect(lastSessionIdOf({ ids: ['s-1', ''] })).toBe('s-1')
    expect(lastSessionIdOf({ ids: [] })).toBeUndefined()
    expect(lastSessionIdOf({ ids: 's-1' })).toBeUndefined()
  })
})

describe('pickSessionId', () => {
  it('prefers the selection, then the most recent row', () => {
    expect(pickSessionId({ current: 's-1', ids: ['s-2', 's-1'] })).toBe('s-1')
    expect(pickSessionId({ ids: ['s-2', 's-1'] })).toBe('s-1')
    expect(pickSessionId({ ids: [] })).toBeUndefined()
  })
})

describe('sessionCreatorOf', () => {
  it('probes the official create member', () => {
    const sessions = { create: vi.fn() }
    expect(sessionCreatorOf(sessions)).toBe(sessions)
  })

  it('reports absence instead of handing back a non-callable service', () => {
    expect(sessionCreatorOf({ list: {} })).toBeUndefined()
    expect(sessionCreatorOf(null)).toBeUndefined()
    expect(sessionCreatorOf('sessions')).toBeUndefined()
  })
})

describe('sessionCwdOf', () => {
  it('reads the directory of the given session row', () => {
    const snapshot = { ids: ['s-1'], byId: { 's-1': { cwd: '/work/dir', blank: false } } }
    expect(sessionCwdOf(snapshot, 's-1')).toBe('/work/dir')
  })

  it('stays undefined without a row, a cwd, or an id', () => {
    expect(sessionCwdOf({ byId: {} }, 's-1')).toBeUndefined()
    expect(sessionCwdOf({ byId: { 's-1': { blank: true } } }, 's-1')).toBeUndefined()
    expect(sessionCwdOf({ byId: { 's-1': { cwd: '' } } }, 's-1')).toBeUndefined()
    expect(sessionCwdOf({ byId: { 's-1': { cwd: '/w' } } }, undefined)).toBeUndefined()
    expect(sessionCwdOf(null, 's-1')).toBeUndefined()
  })
})

describe('createSkillSession', () => {
  it('creates a new session inside the current workspace instead of reusing the active one', async () => {
    const create = vi.fn(async () => 's-new')
    const connectWorkspace = vi.fn(async () => 's-connected')
    const sessionId = await createSkillSession(
      { sessions: { create }, connectWorkspace },
      'ws-1',
      { current: 's-active', ids: ['s-active'] },
    )
    expect(sessionId).toBe('s-new')
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(connectWorkspace).not.toHaveBeenCalled()
  })

  it('falls back to connectWorkspace on cores without sessions.create', async () => {
    const connectWorkspace = vi.fn(async () => 's-connected')
    const sessionId = await createSkillSession(
      { sessions: { list: {} }, connectWorkspace },
      'ws-1',
      { current: 's-active' },
    )
    expect(sessionId).toBe('s-connected')
    expect(connectWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('falls through an empty id from either official entry', async () => {
    const create = vi.fn(async () => '')
    const connectWorkspace = vi.fn(async () => '')
    const sessionId = await createSkillSession(
      { sessions: { create }, connectWorkspace },
      'ws-1',
      { current: 's-active' },
    )
    expect(sessionId).toBe('s-active')
  })

  it('creates in the current directory when the session belongs to no workspace', async () => {
    const create = vi.fn(async () => 's-new')
    const sessionId = await createSkillSession(
      { sessions: { create } },
      undefined,
      { current: 's-ungrouped', ids: ['s-ungrouped'], byId: { 's-ungrouped': { cwd: '/work/dir' } } },
    )
    expect(sessionId).toBe('s-new')
    expect(create).toHaveBeenCalledWith({ cwd: '/work/dir' })
  })

  it('reuses the active session only when neither a workspace nor a cwd is resolvable', async () => {
    const create = vi.fn(async () => 's-new')
    const sessionId = await createSkillSession(
      { sessions: { create } },
      undefined,
      { current: 's-active', ids: ['s-active'] },
    )
    expect(sessionId).toBe('s-active')
    expect(create).not.toHaveBeenCalled()
  })

  it('surfaces an official create failure instead of silently reusing the conversation', async () => {
    const create = vi.fn(async () => { throw new Error('workspace/not-found') })
    await expect(
      createSkillSession({ sessions: { create } }, 'ws-1', { current: 's-active' }),
    ).rejects.toThrow('workspace/not-found')
  })

  it('reports unavailable when nothing can host the draft', async () => {
    expect(await createSkillSession({}, undefined, { ids: [] })).toBeUndefined()
  })
})

describe('chooseWorkspace', () => {
  const sessions = sessionSnapshotOf({ current: 's-1', ids: ['s-1'] })

  it('picks the workspace that owns the current session', () => {
    const workspaces = workspaceSnapshotOf({
      items: [
        { workspaceId: 'ws-a', sessionIds: ['s-9'] },
        { workspaceId: 'ws-b', sessionIds: ['s-1'] },
      ],
    })
    expect(chooseWorkspace(sessions, workspaces)).toBe('ws-b')
  })

  it('falls back to the recent workspace, then to the first row', () => {
    const items = [
      { workspaceId: 'ws-a', sessionIds: [] },
      { workspaceId: 'ws-b', sessionIds: [] },
    ]
    expect(chooseWorkspace(sessions, workspaceSnapshotOf({ items, recentWorkspaceId: 'ws-b' }))).toBe('ws-b')
    expect(chooseWorkspace(sessions, workspaceSnapshotOf({ items }))).toBe('ws-a')
  })

  it('returns undefined without any workspace row', () => {
    expect(chooseWorkspace(sessions, workspaceSnapshotOf({}))).toBeUndefined()
    expect(chooseWorkspace(sessions, workspaceSnapshotOf(null))).toBeUndefined()
  })

  it('accepts the legacy id field', () => {
    const workspaces = workspaceSnapshotOf({ items: [{ id: 'ws-legacy', sessionIds: ['s-1'] }] })
    expect(chooseWorkspace(sessions, workspaces)).toBe('ws-legacy')
  })
})

/**
 * 「插件市场」按钮的降级链（contract §3.2）：官方入口 → 官方插件页 → 不渲染。
 * 每一步都必须静默降级：这些函数返回 undefined 时调用方就不渲染按钮。
 */
describe('openMarketLauncherOf', () => {
  const mainWithPlugins = { entriesOfSlot: () => [{ options: { key: 'plugins' } }] }

  it('prefers the official pluginNavigation entry', () => {
    const openList = vi.fn()
    const selectPanel = vi.fn()
    const ctx = { get: (name: string) => (name === 'pluginNavigation' ? { openList } : name === 'layout' ? { selectPanel } : undefined) }

    const open = openMarketLauncherOf(ctx)
    expect(open).toBeTypeOf('function')
    open?.()
    expect(openList).toHaveBeenCalledTimes(1)
    expect(selectPanel).not.toHaveBeenCalled()
  })

  it('falls back to layout.selectPanel("plugins") when pluginNavigation is absent', () => {
    const selectPanel = vi.fn()
    const ctx = { get: (name: string) => (name === 'layout' ? { selectPanel } : name === 'slots' ? mainWithPlugins : undefined) }

    openMarketLauncherOf(ctx)?.()
    expect(selectPanel).toHaveBeenCalledWith('plugins')
  })

  it('returns undefined without either official entry (button is not rendered)', () => {
    expect(openMarketLauncherOf(undefined)).toBeUndefined()
    expect(openMarketLauncherOf({})).toBeUndefined()
    expect(openMarketLauncherOf({ get: () => undefined })).toBeUndefined()
  })

  it('returns undefined when the official plugins page is not registered in the main slot', () => {
    const selectPanel = vi.fn()
    const ctx = {
      get: (name: string) => (name === 'layout'
        ? { selectPanel }
        : name === 'slots' ? { entriesOfSlot: () => [{ options: { key: 'chat' } }] } : undefined),
    }

    expect(openMarketLauncherOf(ctx)).toBeUndefined()
    expect(selectPanel).not.toHaveBeenCalled()
  })

  it('swallows a throwing selectPanel instead of letting it escape the click handler', () => {
    const selectPanel = vi.fn(() => { throw new Error('panel/not-registered') })
    const ctx = { get: (name: string) => (name === 'layout' ? { selectPanel } : undefined) }
    // 降级本身会打一行 console.debug（现场诊断用），测试里不必把它喷到输出里。
    const quiet = vi.spyOn(console, 'debug').mockImplementation(() => {})

    expect(() => openMarketLauncherOf(ctx)?.()).not.toThrow()
    quiet.mockRestore()
  })

  it('reads services through ctx.get without breaking on a throwing guard', () => {
    const ctx = { get: () => { throw new Error('inject guard') } }
    expect(openMarketLauncherOf(ctx)).toBeUndefined()
  })
})

/**
 * 「插件市场」按钮的第二段（contract §3.3）：打开官方页之后**点「发现」tab**。
 *
 * 官方 `pluginNavigation` 只有 `openList()` / `openBundle()`，两者都把页面强制切到 `installed`，
 * 没有「打开 discover」的接口。于是只能：先打开页面 → 轮询 DOM 找 `${tabsId}-<tabId>` 那个按钮
 * → 点它 → 校验 `aria-selected`。任何一步失败都静默降级（用户落在「已安装」，仍然可用）。
 */
describe('「插件市场」直达「发现」tab', () => {
  const withDiscoverEntry = { entriesOfSlot: () => [{ options: { id: 'discover', label: () => '发现' } }] }
  const slotsOf = (entries: unknown[]) => ({ entriesOfSlot: () => entries })

  /** 只实现补丁用到的三个面：click / getAttribute，以及点击后真的把选中态改掉。 */
  function fakeTabButton(tabId: string, clicked: string[], shape: 'aria-selected' | 'data-state' | 'none' = 'aria-selected') {
    const attributes: Record<string, string> = {}
    if (shape === 'aria-selected')
      attributes['aria-selected'] = 'false'
    if (shape === 'data-state')
      attributes['data-state'] = 'inactive'
    return {
      click: () => {
        clicked.push(tabId)
        if (shape === 'aria-selected')
          attributes['aria-selected'] = 'true'
        if (shape === 'data-state')
          attributes['data-state'] = 'active'
      },
      getAttribute: (name: string) => attributes[name] ?? null,
    }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('discoverTabTargetOf 优先取 discover，其次取槽里第一个，槽为空或服务缺席时为 undefined', () => {
    expect(discoverTabTargetOf({ get: (name: string) => (name === 'slots' ? withDiscoverEntry : undefined) }))
      .toEqual({ tabId: 'discover', label: '发现' })
    // 没装市场时 `plugins.tab` 里可能只有官方的「已安装」等条目：拿第一个，别硬编码 discover。
    expect(discoverTabTargetOf({ get: () => slotsOf([{ options: { id: 'installed', label: '已安装' } }]) }))
      .toEqual({ tabId: 'installed', label: '已安装' })
    expect(discoverTabTargetOf({ get: () => slotsOf([]) })).toBeUndefined()
    expect(discoverTabTargetOf({ get: () => ({}) })).toBeUndefined()
    expect(discoverTabTargetOf(undefined)).toBeUndefined()
  })

  it('打开官方页之后按 id 后缀点到「发现」，并校验 aria-selected', () => {
    vi.useFakeTimers()
    const clicked: string[] = []
    const button = fakeTabButton('discover', clicked)
    vi.stubGlobal('document', {
      querySelector: (selector: string) => (selector === '[id$="-discover"]' ? button : null),
      querySelectorAll: () => [],
    })
    const openList = vi.fn()
    const ctx = { get: (name: string) => (name === 'pluginNavigation' ? { openList } : name === 'slots' ? withDiscoverEntry : undefined) }

    openMarketLauncherOf(ctx)?.()
    expect(openList).toHaveBeenCalledTimes(1)
    // 页面此刻才被点开：先等一拍，别在官方页挂载前把 30 次配额耗光。
    expect(clicked).toEqual([])

    vi.advanceTimersByTime(100)
    expect(clicked).toEqual(['discover'])
  })

  it('没有 plugins.tab 条目时只打开页面，不碰 DOM', () => {
    vi.useFakeTimers()
    const querySelector = vi.fn(() => null)
    vi.stubGlobal('document', { querySelector, querySelectorAll: () => [] })
    const openList = vi.fn()
    const ctx = { get: (name: string) => (name === 'pluginNavigation' ? { openList } : undefined) }

    openMarketLauncherOf(ctx)?.()
    vi.advanceTimersByTime(3_000)

    expect(openList).toHaveBeenCalledTimes(1)
    expect(querySelector).not.toHaveBeenCalled()
  })

  it('DOM 里始终没有那个 tab 就静默放弃：不抛错，只留一行现场诊断', () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] })
    const ctx = { get: (name: string) => (name === 'pluginNavigation' ? { openList: vi.fn() } : name === 'slots' ? withDiscoverEntry : undefined) }

    expect(() => openMarketLauncherOf(ctx)?.()).not.toThrow()
    expect(() => vi.advanceTimersByTime(3_000)).not.toThrow()
    expect(debug).toHaveBeenCalled()
  })

  it('id 后缀匹配不到时退到 tablist 里按 label 文本匹配（不写死中英文）', () => {
    const clicked: string[] = []
    const button = { ...fakeTabButton('t-1', clicked), textContent: ' 发现 ' }
    const root = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => (selector === '[role="tablist"]' ? [{ querySelectorAll: () => [button] }] : []),
    }

    expect(activateDiscoverTab(root, { tabId: 'discover', label: '发现' })).toBe('activated')
    expect(clicked).toEqual(['t-1'])
  })

  it('点了但没切过去（aria-selected 仍为 false）就放弃，不继续轮询', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const button = { click: () => {}, getAttribute: (name: string) => (name === 'aria-selected' ? 'false' : null) }
    const root = { querySelector: () => button, querySelectorAll: () => [] }

    expect(activateDiscoverTab(root, { tabId: 'discover' }, debug)).toBe('rejected')
    expect(debug).toHaveBeenCalled()
  })

  it('选中态按 aria-selected，其次 data-state；两个都没有时不谎报失败', () => {
    const withAttribute = (name: string, value: string) => ({ click: () => {}, getAttribute: (key: string) => (key === name ? value : null) })

    expect(discoverTabActive(withAttribute('aria-selected', 'true'))).toBe(true)
    expect(discoverTabActive(withAttribute('aria-selected', 'false'))).toBe(false)
    expect(discoverTabActive(withAttribute('data-state', 'active'))).toBe(true)
    expect(discoverTabActive(withAttribute('data-state', 'inactive'))).toBe(false)
    expect(discoverTabActive({ click: () => {}, getAttribute: () => null })).toBe(true)
  })
})

/**
 * `resolveText` 的注入面：语言由运行时决定，组件只调用解析器。
 * 这里是「拿不到解析器 / 解析器抛错」两种降级路径的唯一覆盖点。
 */
describe('resolveTextOf', () => {
  it('binds the official ctx.locale.resolveText so the component never touches ctx', () => {
    const resolveText = vi.fn((text: { en: string, zh: string }) => text.zh)
    const ctx = { get: (name: string) => (name === 'locale' ? { resolveText } : undefined) }

    expect(resolveTextOf(ctx)?.({ en: 'Official', zh: '官方' })).toBe('官方')
  })

  it('reports absence when the locale service or the member is missing', () => {
    expect(resolveTextOf(undefined)).toBeUndefined()
    expect(resolveTextOf({ get: () => ({}) })).toBeUndefined()
    expect(resolveTextOf({ get: () => undefined })).toBeUndefined()
  })

  it('turns a throwing resolver into an empty string instead of breaking the render', () => {
    const ctx = { get: () => ({ resolveText: () => { throw new Error('locale disposed') } }) }
    expect(resolveTextOf(ctx)?.({ en: 'Official', zh: '官方' })).toBe('')
  })
})
