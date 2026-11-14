import type { ExtensionRouteDeps } from './index.types'
import { defineRoutes } from 'dsh-tauri'
import archivePlan from './archive/plan/post'
import archiveRemove from './archive/delete'
import archived from './archive/get'
import pendingCancel from './archive/pending/cancel/post'
import archiveUnarchive from './archive/unarchive/post'
import restartCheck from './host/restart/get'
import restart from './host/restart/post'
import importApply from './import/apply/post'
import importScan from './import/scan/get'
import mcpCheck from './mcp/check/post'
import mcpCopy from './mcp/copy/post'
import mcpRemove from './mcp/delete'
import mcp from './mcp/get'
import mcpSave from './mcp/post'
import mcpToggle from './mcp/toggle/post'
import openDir from './open/dir/post'
import pluginBundleToggle from './plugins/bundle/toggle/post'
import plugins from './plugins/get'
import rootsRemove from './roots/delete'
import roots from './roots/get'
import rootsAdd from './roots/post'
import skillDelete from './skill/delete'
import skill from './skill/get'
import skillPolicy from './skill/policy/post'
import skillSave from './skill/post'
import skills from './skills/get'
import skillsRefresh from './skills/refresh/post'

export const routes = defineRoutes<ExtensionRouteDeps>((disposer) => {
  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/skills' }, skills)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/skills/refresh' }, skillsRefresh)
  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/skill' }, skill)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/skill' }, skillSave)
  disposer.delete({ kind: 'exact', path: '/dsh-toolshed/api/skill' }, skillDelete)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/skill/policy' }, skillPolicy)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/open/dir' }, openDir)

  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/mcp' }, mcp)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/mcp' }, mcpSave)
  disposer.delete({ kind: 'exact', path: '/dsh-toolshed/api/mcp' }, mcpRemove)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/mcp/toggle' }, mcpToggle)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/mcp/check' }, mcpCheck)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/mcp/copy' }, mcpCopy)

  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/import/scan' }, importScan)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/import/apply' }, importApply)

  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/roots' }, roots)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/roots' }, rootsAdd)
  disposer.delete({ kind: 'exact', path: '/dsh-toolshed/api/roots' }, rootsRemove)

  // 已归档会话管理：列表 / dry-run 计划 / 删除 / 取消归档 / 取消待删除。
  // 路径数 +5（defineRoutes 按 (kind, path) 收敛，同一路径多方法只占一行注册）。
  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/archived' }, archived)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/archive/plan' }, archivePlan)
  disposer.delete({ kind: 'exact', path: '/dsh-toolshed/api/archive' }, archiveRemove)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/archive/unarchive' }, archiveUnarchive)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/archive/pending/cancel' }, pendingCancel)

  // 服务页：GET 读状态、POST 执行重启（同一 path，仍是一行注册）。
  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/host/restart' }, restartCheck)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/host/restart' }, restart)

  // 插件启停：走官方 `pluginManager` 服务（投影与判定在 service/plugins.ts，纯函数可脱离 DSH 单测）。
  // 路径数 -1，回到 20：这个 tab 只讲 npm 包，行级启停（`POST /plugins/toggle`）已随行级视图一起删除，
  // 条目级的精细开关交给官方「插件」页。启停仍独立成路径而不是复用 POST /plugins：读清单是幂等的，
  // 启停会写用户 `dsh.profile.bundles`。
  disposer.get({ kind: 'exact', path: '/dsh-toolshed/api/plugins' }, plugins)
  disposer.post({ kind: 'exact', path: '/dsh-toolshed/api/plugins/bundle/toggle' }, pluginBundleToggle)
})
