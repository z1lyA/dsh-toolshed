/**
 * 「插件」tab 的宿主服务层：把官方 `pluginManager` 服务投影成线协议。
 *
 * 为什么要拆成「取服务」+「纯函数」两层：官方包一律 external（AGENTS 约束 4），拿不到它的类型，
 * 只能按名字取服务再鸭子类型化；把投影与判定写成不碰 ctx 的纯函数，就能脱离 DSH 单测，
 * 而路由只负责取 body、映射 HTTP 状态。
 *
 * 官方语义（`packages/boot/plugin-manager/src/index.ts`，证据见 `.spike/spike-host.md`）：
 * 启停**先写用户 patch 再热重载**，失败不抛异常而是回 `application:'failed'` + `error.code`——
 * 所以这里必须判 `application`，只 try/catch 会把失败当成功。
 */
import type { HostServiceHub } from './archive'
import type { PluginRowView, PluginsListResponse, PluginToggleBody, PluginToggleResponse } from './plugins.types'
import { ArchiveRequestError } from './archive'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

/**
 * 官方 `plugin-manager` 的公开契约在本地的最小镜像（官方包 external，不能 import 类型）。
 *
 * 只声明我们真正会调的两个方法：多写不用到的方法会随官方演进变脆。
 */
export interface OfficialPluginInfo {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase?: string | null
  /** 与 `readOnlyReason` 互斥：有它才可启停。 */
  patchId?: string
  readOnlyReason?: string
}

export interface OfficialChangeResult {
  changed: boolean
  application: string
  error?: { code?: string, diagnostic?: string }
}

export interface PluginManagerService {
  listPlugins: () => Promise<OfficialPluginInfo[]>
  setPluginEnabled: (entryId: string, enabled: boolean) => Promise<OfficialChangeResult>
}

/** 服务层自己判定的拒绝；`code` 是稳定机器码，路由层据它映射 HTTP 状态。 */
export class PluginRequestError extends ArchiveRequestError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'PluginRequestError'
  }
}

/** 我们自己这一行的模块名：停它等于当场拆掉本面板（`cordis.patch.yml` 的 insert 行）。 */
const SELF_MODULE = 'dsh-toolshed'

/** 官方的「成功」集合：`failed` / `cancelled` 之外的三种都算写成功。 */
const OK_APPLICATIONS = new Set(['applied', 'restart-required', 'overridden'])

/**
 * 按名字取服务：`ctx.get` 是 cordis 的正规入口，属性兜底只为 ctx 被换过形态的组合（照 restart.ts）。
 *
 * 拆卸期访问服务可能抛错，这里吞掉并当成「没有」——调用方会得到明确的 503 而不是 500。
 */
function readService(ctx: HostServiceHub, name: string): unknown {
  try {
    if (typeof ctx?.get === 'function')
      return ctx.get(name)
  }
  catch {}
  try {
    return (ctx as Record<string, unknown> | undefined)?.[name]
  }
  catch {
    return undefined
  }
}

/**
 * 惰性解析官方 `pluginManager`。
 *
 * 绝不能把这个名字写进 `apply.ts` 导出的 `inject`：那里每多一个名字，缺该服务的组合
 * （非 profile 启动、老 DSH）就会让整个面板（含 MCP / 技能）一起不挂载——`apply.ts` 顶部注释的既有教训。
 */
export function resolvePluginManager(ctx: HostServiceHub): PluginManagerService | undefined {
  const candidate = readService(ctx, 'pluginManager')
  if (candidate === null || typeof candidate !== 'object')
    return undefined
  const manager = candidate as PluginManagerService
  // 鸭子类型而非 instanceof：服务是官方包里的类，我们两个方法都在才算可用（老版本可能缺 setPluginEnabled）。
  return typeof manager.listPlugins === 'function' && typeof manager.setPluginEnabled === 'function'
    ? manager
    : undefined
}

/**
 * 把官方条目投影成线协议行。
 *
 * 逐字段搬运、**不重排**：官方顺序就是 loader 的顺序，重排会让用户「刷新后行位置全变了」。
 * 形状不对的条目直接丢弃：官方字段漂移时宁可少一行，也不要一条坏数据让整页 500。
 * `readOnlyReason` 原样透出——原因码是对外契约，客户端照官方中文词典翻译，这里不校验取值。
 */
export async function listPluginRows(manager: PluginManagerService): Promise<PluginRowView[]> {
  const rows = await manager.listPlugins()
  if (!Array.isArray(rows))
    return []
  const projected: PluginRowView[] = []
  for (const item of rows) {
    if (item === null || typeof item !== 'object')
      continue
    const row = item as OfficialPluginInfo
    if (typeof row.entryId !== 'string' || typeof row.moduleName !== 'string')
      continue
    const view: PluginRowView = {
      entryId: row.entryId,
      moduleName: row.moduleName,
      enabled: row.enabled === true,
      fiberPhase: typeof row.fiberPhase === 'string' ? row.fiberPhase : null,
    }
    if (typeof row.patchId === 'string')
      view.patchId = row.patchId
    if (typeof row.readOnlyReason === 'string')
      view.readOnlyReason = row.readOnlyReason
    projected.push(view)
  }
  return projected
}

/** 这一行是不是本面板自己：`moduleName` 是权威标识，`patchId` 同形时一并挡（改名安装也要拦住）。 */
function isSelfRow(row: OfficialPluginInfo | undefined): boolean {
  if (row === null || row === undefined || typeof row !== 'object')
    return false
  return row.moduleName === SELF_MODULE || row.patchId === SELF_MODULE
}

/**
 * `application` 原样透出，只在这里判 `ok`。
 *
 * 为什么不做归一化：压成布尔会让「被更高优先级 patch 覆盖」伪装成成功；而「启用后激活失败」时
 * 配置文件其实已经写了（`changed: true`），页面必须据此如实提示并给撤销入口。
 */
function toToggleResponse(result: OfficialChangeResult | undefined): PluginToggleResponse {
  const application = typeof result?.application === 'string' ? result.application : 'failed'
  const response: PluginToggleResponse = {
    ok: OK_APPLICATIONS.has(application),
    application,
    changed: result?.changed === true,
  }
  const error = result?.error
  if (error !== null && error !== undefined && typeof error === 'object') {
    if (typeof error.code === 'string')
      response.errorCode = error.code
    if (typeof error.diagnostic === 'string')
      response.diagnostic = error.diagnostic
  }
  return response
}

/**
 * 启停一个插件。
 *
 * 判定顺序：先自管理硬拒绝（官方不知道该保护我们：本面板的行在保护集之外，技术上可被自己停掉，
 * 停完面板当场消失且没有恢复入口），再把请求交给官方服务。
 *
 * 官方对 `unknown-plugin` / `management-required` / 写盘失败一律**不抛异常**、回
 * `application:'failed'` + `error.code`（`.spike/spike-host.md` §4），所以这里不替它预判
 * `readOnlyReason`：让官方的拒绝原样回到页面，只有一份事实来源。
 */
export async function togglePlugin(
  manager: PluginManagerService,
  entryId: string,
  enabled: boolean,
): Promise<PluginToggleResponse> {
  const rows = await manager.listPlugins()
  const row = Array.isArray(rows) ? rows.find(item => item?.entryId === entryId) : undefined
  // 只挡「停用自己」：重新启用自己时本插件根本没在跑，不会走到这里。
  if (enabled === false && isSelfRow(row)) {
    throw new PluginRequestError(
      PLUGIN_SELF_MANAGEMENT,
      'dsh-toolshed cannot disable itself: the panel would disappear immediately and there is no way back from the UI',
    )
  }
  return toToggleResponse(await manager.setPluginEnabled(entryId, enabled))
}

export interface PluginsAdmin {
  /** 全量清单：官方 `listPlugins()` 本身就是全量（本机实测 227 条），过滤放在页面搜索框。 */
  list: () => Promise<PluginsListResponse>
  toggle: (body: PluginToggleBody) => Promise<PluginToggleResponse>
}

/**
 * 构造绑定到一次 apply 的插件 admin（照 `createArchiveAdmin` / `createRestartAdmin` 的写法）。
 *
 * 服务在**请求期**才按名字取：apply 期取不到（老 DSH / 非 profile 启动）也不该让整个面板挂不上，
 * 页面拿到 503 + `plugin-manager-unavailable` 后自己降级成「当前版本不支持插件管理」。
 */
export function createPluginsAdmin(ctx: HostServiceHub): PluginsAdmin {
  const managerOrThrow = (): PluginManagerService => {
    const manager = resolvePluginManager(ctx)
    if (manager === undefined) {
      throw new PluginRequestError(
        PLUGIN_MANAGER_UNAVAILABLE,
        'the pluginManager service is not mounted in this dsh build',
      )
    }
    return manager
  }
  return {
    list: async () => ({ plugins: await listPluginRows(managerOrThrow()) }),
    toggle: async body => togglePlugin(managerOrThrow(), body.entryId, body.enabled),
  }
}
