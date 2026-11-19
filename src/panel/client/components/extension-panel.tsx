import type { ReactElement } from 'react'
import type { ResolveLocalizedText } from './plugins-tab.types'
import { SegmentedControl } from 'dsh-tauri-ui/client'
import { useEffect, useId, useState } from 'react'
import { locale } from '../locales'
import { ArchiveTab } from './archive-tab'
import { resolveActiveTab } from './extension-panel.utils'
import { McpTab } from './mcp-tab'
import { PluginsTab } from './plugins-tab'
import { RestartControl } from './restart-control'
import { SkillsTab } from './skills-tab'

export interface ExtensionPanelProps {
  createSkill: () => Promise<void>
  /**
   * 「插件市场」入口（见 register/extension-panel.tsx 的三级降级）。
   *
   * 组件本身不碰 ctx：SSR 冒烟里没有上下文。`undefined` 表示连官方插件页都打不开，
   * 此时按钮不渲染（渲染一个点了没反应的市场按钮比没有更糟）。
   */
  openMarket?: () => void
  /**
   * 「官方插件页」入口：本页只管第三方包，官方包的启停 / 卸载 / 换版本去官方页做。
   *
   * 与 `openMarket` 是**两条**入口：市场落在官方页的「发现」，官方插件页落在「已安装」。
   * 同样拿不到就不渲染按钮。
   */
  openOfficialPage?: () => void
  /**
   * 本地化文案解析器（`ctx.locale.resolveText`）。
   *
   * 同上：语言由运行时决定，组件只调用，不自己挑；拿不到时退回 `en`。
   */
  resolveText?: ResolveLocalizedText
}

interface ExtensionTab {
  id: string
  label: string
  render: () => ReactElement
}

export function ExtensionPanel({ createSkill, openMarket, openOfficialPage, resolveText }: ExtensionPanelProps): ReactElement {
  const t = locale.text
  const tabsId = useId()
  const rows: ExtensionTab[] = [
    // 顺序是用户明确要求的「技能 / 插件 / 会话 / MCP」：这是 AGENTS「新 tab 追加在末尾」
    // 那条例外的唯一来源——`rows[0]` 仍是技能（默认页不变），插件从末尾挪到第二位。
    { id: 'skills', label: t('skillsTab'), render: () => <SkillsTab t={t} createSkill={createSkill} /> },
    { id: 'plugins', label: t('pluginsTab'), render: () => <PluginsTab t={t} openMarket={openMarket} openOfficialPage={openOfficialPage} resolveText={resolveText} /> },
    { id: 'archive', label: t('archiveTab'), render: () => <ArchiveTab t={t} /> },
    { id: 'mcp', label: t('mcpTab'), render: () => <McpTab t={t} /> },
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
