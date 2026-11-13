import type { Translate } from '../locales/index.types'

export interface ArchiveTabProps {
  t: Translate
}

/** 删除结果里要完整展示的一条失败/警告。 */
export interface ArchiveFailureLine {
  id: string
  text: string
}
