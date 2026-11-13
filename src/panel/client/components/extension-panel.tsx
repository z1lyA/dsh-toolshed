import type { ReactElement } from 'react'
import { SegmentedControl } from 'dsh-tauri-ui/client'
import { useEffect, useId, useState } from 'react'
import { locale } from '../locales'
import { ArchiveTab } from './archive-tab'
import { resolveActiveTab } from './extension-panel.utils'
import { McpTab } from './mcp-tab'
import { RestartControl } from './restart-control'
import { SkillsTab } from './skills-tab'

export interface ExtensionPanelProps {
  createSkill: () => Promise<void>
}

interface ExtensionTab {
  id: string
  label: string
  render: () => ReactElement
}

export function ExtensionPanel({ createSkill }: ExtensionPanelProps): ReactElement {
  const t = locale.text
  const tabsId = useId()
  const rows: ExtensionTab[] = [
    { id: 'skills', label: t('skillsTab'), render: () => <SkillsTab t={t} createSkill={createSkill} /> },
    { id: 'mcp', label: t('mcpTab'), render: () => <McpTab t={t} /> },
    { id: 'archive', label: t('archiveTab'), render: () => <ArchiveTab t={t} /> },
  ]
  const initialId = rows[0]?.id ?? 'skills'
  const [requestedId, setRequestedId] = useState(initialId)
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([initialId]))
  const activeId = resolveActiveTab(rows, requestedId)
  useEffect(() => setVisited(previous => previous.has(activeId) ? previous : new Set([...previous, activeId])), [activeId])

  return (
    <div className="dshp-extension">
      <div className="dshp-extension__section">
        {/* 标签页与重启控件同一行：重启是宿主级低频动作，不占整页；状态与原因在按钮的 title 上。 */}
        <div className="dshp-extension__head-row">
          <SegmentedControl
            id={tabsId}
            label={t('extension')}
            value={activeId}
            options={rows.map(row => ({ value: row.id, label: row.label }))}
            onChange={setRequestedId}
          />
          <span className="dshp-extension__spacer" />
          <RestartControl t={t} />
        </div>
        {rows.filter(row => row.id === activeId || visited.has(row.id)).map((row) => {
          const selected = row.id === activeId
          return <div key={row.id} id={`${tabsId}-${row.id}-panel`} className="dshp-extension__tab-panel" role="tabpanel" aria-labelledby={`${tabsId}-${row.id}`} hidden={!selected}>{row.render()}</div>
        })}
      </div>
    </div>
  )
}
