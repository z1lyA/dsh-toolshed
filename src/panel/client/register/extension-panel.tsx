import type { ClientContext, PanelHandle } from 'dsh-tauri/client'
import { Icon, PanelPage, Puzzle } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { ExtensionPanel } from '../components/extension-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'
import { store } from '../store'
import { chooseWorkspace, createSkillSession, sessionSnapshotOf, workspaceSnapshotOf } from './extension-panel.utils'

export const extensionPanelFeature = defineRegister<ClientContext>((controller, ctx, adapter) => {
  let panel: PanelHandle | undefined

  // 「新建技能」＝在**当前目录**（当前会话所属工作区）开一条新对话，再把 `/skill-creator `
  // 预填进那条会话的输入框：预填组件注册在每个会话输入框上，按 sessionId 认领草稿
  // （见 `skill-creator-prefill` 的 `inject: (sessionId) => ({ sessionId })`）。
  //
  // 上游只有「工作区 → connectWorkspace 开新会话」一条链路；0.1.7 起导航搬到 `uiWorkspace`，
  // 官方「在当前目录新建对话」的入口变成 `sessions.create({ workspaceId })`（适配层把
  // `uiWorkspace.connectWorkspace` 投影回 `workspaces`，留作退级第二级）。
  // 三级都拿不到会话时不再静默复用：把实际服务面打到控制台并报错，便于一次定位。
  const createSkill = async (): Promise<void> => {
    const sessionSnapshot = adapter.sessions.list?.getSnapshot()
    const workspaceId = chooseWorkspace(
      sessionSnapshotOf(sessionSnapshot),
      workspaceSnapshotOf(adapter.workspaces.list?.getSnapshot()),
    )
    const sessionId = await createSkillSession(
      { sessions: adapter.sessions, connectWorkspace: adapter.workspaces.connectWorkspace },
      workspaceId,
      sessionSnapshot,
    )
    if (sessionId === undefined) {
      console.warn('[dsh-toolshed] createSkill: no session available', {
        sessions: adapter.sessions?.list?.getSnapshot?.(),
        workspaces: adapter.workspaces?.list?.getSnapshot?.(),
      })
      throw new Error(locale.text('workspaceUnavailable'))
    }
    store.prefill.add(sessionId)
    panel?.close()
    adapter.openSession(sessionId)
  }

  panel = definePanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ACTION_ORDER,
    locale: locale.NS,
    label: () => locale.text('extension'),
    icon: props => <Icon as={Puzzle} size={props.size} />,
    render: () => (
      <PanelPage>
        <ExtensionPanel createSkill={createSkill} />
      </PanelPage>
    ),
  })
  controller.add(panel.dispose)
})
