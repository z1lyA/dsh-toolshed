import { describe, expect, it, vi } from 'vitest'
import {
  chooseWorkspace,
  createSkillSession,
  currentSessionIdOf,
  lastSessionIdOf,
  openMarketLauncherOf,
  pickSessionId,
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
