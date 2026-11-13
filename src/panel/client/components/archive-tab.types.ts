import type { Translate } from '../locales/index.types'

export interface ArchiveTabProps {
  t: Translate
  /** 切到别的 tab（待删除条目提示「去服务页重启」时用）。 */
  onNavigate: (id: string) => void
}

/** 删除结果里要完整展示的一条失败/警告。 */
export interface ArchiveFailureLine {
  id: string
  text: string
}
