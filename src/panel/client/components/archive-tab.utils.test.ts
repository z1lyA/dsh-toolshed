/**
 * client/components/archive-tab.utils.test.ts — 「会话」页按工作区分组的口径。
 *
 * 守三件事：分组主层级（工作区一行一组）、「未关联工作区」置底、三态勾选（全选 / 半选）的判定。
 * 这三条一旦漂移，界面上就会同时出现「组里有会话却显示全选」和「全选了却还显示半选」两种错。
 */

import type { ArchivedSessionView } from '../apis/index.type'
import { describe, expect, it } from 'vitest'
import { groupSessionsByWorkspace, selectionState, UNASSIGNED_WORKSPACE_KEY } from './archive-tab.utils'

function row(id: string, workspace?: { id?: string, title?: string }, extra: Partial<ArchivedSessionView> = {}): ArchivedSessionView {
  return {
    id,
    workspaceId: workspace?.id,
    workspaceTitle: workspace?.title,
    logBytes: 0,
    cacheBytes: 0,
    totalBytes: 10,
    logFiles: 1,
    hasLog: true,
    duplicate: false,
    live: false,
    descendants: [],
    ...extra,
  }
}

describe('groupSessionsByWorkspace', () => {
  it('主层级是工作区：一个工作区一组，组内保持宿主给的顺序', () => {
    const groups = groupSessionsByWorkspace([
      row('a', { id: 'ws-1', title: 'Alpha' }),
      row('b', { id: 'ws-1', title: 'Alpha' }),
      row('c', { id: 'ws-2', title: 'Beta' }),
    ])

    expect(groups.map(group => group.title)).toEqual(['Alpha', 'Beta'])
    expect(groups[0].rows.map(item => item.id)).toEqual(['a', 'b'])
    expect(groups[1].rows.map(item => item.id)).toEqual(['c'])
  })

  it('组按工作区名排序，而不是按首次出现顺序', () => {
    const groups = groupSessionsByWorkspace([
      row('a', { id: 'ws-2', title: 'Beta' }),
      row('b', { id: 'ws-1', title: 'Alpha' }),
    ])

    expect(groups.map(group => group.title)).toEqual(['Alpha', 'Beta'])
  })

  it('没有 workspace 的会话归到「未关联工作区」并置底', () => {
    const groups = groupSessionsByWorkspace([
      row('loose'),
      row('a', { id: 'ws-1', title: 'Alpha' }),
      row('also-loose'),
    ])

    expect(groups.map(group => group.key)).toEqual(['workspace:ws-1', UNASSIGNED_WORKSPACE_KEY])
    expect(groups[1].title).toBeUndefined()
    expect(groups[1].rows.map(item => item.id)).toEqual(['loose', 'also-loose'])
  })

  it('没有未关联会话时不造空组', () => {
    const groups = groupSessionsByWorkspace([row('a', { id: 'ws-1', title: 'Alpha' })])
    expect(groups).toHaveLength(1)
  })

  it('同名工作区不合并：键用 id，标题只用于展示', () => {
    const groups = groupSessionsByWorkspace([
      row('a', { id: 'ws-1', title: '同名' }),
      row('b', { id: 'ws-2', title: '同名' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.key)).toEqual(['workspace:ws-1', 'workspace:ws-2'])
  })

  it('组头统计按组汇总占用与会条目数', () => {
    const groups = groupSessionsByWorkspace([
      row('a', { id: 'ws-1', title: 'Alpha' }, { totalBytes: 100 }),
      row('b', { id: 'ws-1', title: 'Alpha' }, { totalBytes: 24, pending: { requestedAt: '2026-01-01T00:00:00Z', cleanupAttachments: false, attempts: 0, lastError: null, lastAttemptAt: null } }),
      row('c', { id: 'ws-2', title: 'Beta' }, { totalBytes: 5 }),
    ])

    expect(groups[0].totalBytes).toBe(124)
    expect(groups[0].pendingCount).toBe(1)
    expect(groups[1].totalBytes).toBe(5)
    expect(groups[1].pendingCount).toBe(0)
  })

  it('空清单不造组', () => {
    expect(groupSessionsByWorkspace([])).toEqual([])
  })
})

describe('selectionState', () => {
  const ids = ['a', 'b', 'c']

  it('一个都没选：既不勾选也不半选', () => {
    expect(selectionState(ids, new Set())).toEqual({ checked: false, indeterminate: false, count: 0 })
  })

  it('选了一部分：半选', () => {
    expect(selectionState(ids, new Set(['a']))).toEqual({ checked: false, indeterminate: true, count: 1 })
  })

  it('全选中：勾选，不再显示半选', () => {
    expect(selectionState(ids, new Set(ids))).toEqual({ checked: true, indeterminate: false, count: 3 })
  })

  it('空集合：空白组不该显示「选了一半」', () => {
    expect(selectionState([], new Set(['a']))).toEqual({ checked: false, indeterminate: false, count: 0 })
  })

  it('选中集合里残留的已消失 id 不参与判定（否则全选会永远卡在半选）', () => {
    expect(selectionState(ids, new Set([...ids, 'gone']))).toEqual({ checked: true, indeterminate: false, count: 3 })
  })
})
