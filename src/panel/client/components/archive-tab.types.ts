import type { ArchivedSessionView } from '../apis/index.type'
import type { Translate } from '../locales/index.types'

export interface ArchiveTabProps {
  t: Translate
}

/** 删除结果里要完整展示的一条失败/警告。 */
export interface ArchiveFailureLine {
  id: string
  text: string
}

/** 「会话」页的主层级：一行一个工作区，会话行收在组里。 */
export interface ArchiveWorkspaceGroup {
  /** 分组键，同时充当展开状态的键（用工作区 id 而不是标题：同名工作区各算一组，刷新后展开状态还能对上）。 */
  key: string
  /** 工作区名。undefined 就是「未关联工作区」兜底组——宿主取不到 workspace 域时 id 与标题一起缺。 */
  title?: string
  rows: ArchivedSessionView[]
  totalBytes: number
  pendingCount: number
}

/** 勾选框三态。`checked` 与 `indeterminate` 互斥，跟原生 checkbox 的语义一致。 */
export interface SelectionState {
  checked: boolean
  indeterminate: boolean
  count: number
}
