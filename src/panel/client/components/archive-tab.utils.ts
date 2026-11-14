import type { ArchivedSessionView } from '../apis/index.type'
import type { ArchiveWorkspaceGroup, SelectionState } from './archive-tab.types'

/** 兜底分组键。故意用一个不可能当工作区 id 的形状，免得和某个真工作区分到同一组。 */
export const UNASSIGNED_WORKSPACE_KEY = '__unassigned-workspace__'

/**
 * 按工作区把已归档会话分组。
 *
 * 口径（都是刻意的决定，别顺手改）：
 *  - 组的顺序按工作区名排；同名工作区不是同一个组（键用 id），稳定保留首次出现顺序；
 *  - 「未关联工作区」永远压在最后——它不是一个工作区，混在中间会让人以为漏掉了某个工作区；
 *  - **组内保持宿主给的顺序**：宿主已经按时间/名称排过一遍，客户端再排一次就会出现两套排序口径。
 */
export function groupSessionsByWorkspace(rows: readonly ArchivedSessionView[]): ArchiveWorkspaceGroup[] {
  const groups = new Map<string, ArchiveWorkspaceGroup>()
  for (const row of rows) {
    const attached = row.workspaceId !== undefined || row.workspaceTitle !== undefined
    const key = attached ? `workspace:${row.workspaceId ?? row.workspaceTitle}` : UNASSIGNED_WORKSPACE_KEY
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        key,
        title: attached ? row.workspaceTitle ?? row.workspaceId : undefined,
        rows: [],
        totalBytes: 0,
        pendingCount: 0,
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    group.totalBytes += row.totalBytes
    if (row.pending !== undefined)
      group.pendingCount += 1
  }

  const unassigned = groups.get(UNASSIGNED_WORKSPACE_KEY)
  const attachedGroups = [...groups.values()].filter(group => group.key !== UNASSIGNED_WORKSPACE_KEY)
  // 中文标题按拼音序比码点序更像人排的；用固定 locale 而不是跟随运行环境，免得同一个列表在两台机器上顺序不同。
  attachedGroups.sort((left, right) => (left.title ?? '').localeCompare(right.title ?? '', 'zh-Hans-CN'))
  return unassigned === undefined ? attachedGroups : [...attachedGroups, unassigned]
}

/**
 * 三态勾选框的判定（全局全选与组内全选共用一份口径）。
 *
 * 只数 `ids` 里的命中项，`selected` 里残留的已消失 id 不参与——刷新后消失的行不该继续把
 * 「全选」卡在半选上（页面里 `selectable` 的收敛是同一个理由）。
 * 空集合既不是 checked 也不是 indeterminate：indeterminate 的勾选框看起来像「选了一半」，
 * 用在「这一组一条会话都没有」时是误报。
 */
export function selectionState(ids: readonly string[], selected: ReadonlySet<string>): SelectionState {
  let count = 0
  for (const id of ids) {
    if (selected.has(id))
      count += 1
  }
  return {
    checked: ids.length > 0 && count === ids.length,
    indeterminate: count > 0 && count < ids.length,
    count,
  }
}
