/**
 * 「插件」tab 的宿主服务层：把官方 `pluginManager` 服务投影成线协议。
 *
 * 为什么要拆成「取服务」+「纯函数」两层：官方包一律 external（AGENTS 约束 4），拿不到它的类型，
 * 只能按名字取服务再鸭子类型化；把投影与判定写成不碰 ctx 的纯函数，就能脱离 DSH 单测，
 * 而路由只负责取 body、映射 HTTP 状态。
 *
 * 官方语义（`dsh-plugin-manager/src/index.ts`，证据见 `.spike/spike-host.md` / `contract-v2.md`）：
 * 启停**先写用户 patch 再热重载**，失败不抛异常而是回 `application:'failed'` + `error.code`——
 * 所以这里必须判 `application`，只 try/catch 会把失败当成功。
 *
 * 2.2.0 起有两层清单：`listPlugins()` 是 Loader 条目（本机 227 条，绝大多数是 DSH 自己的内部模块），
 * `listBundles()` 是 npm 包。页面以包为主视图（官方页的卡片就是包级的），扁平条目只留作计数与搜索，
 * 所以一次请求要同时投影两者，并让包里的行按 `entryId` join 回条目状态。
 */
import type { HostServiceHub } from './archive'
import type {
  LocalizedTextView,
  PluginBundleRowView,
  PluginBundleToggleBody,
  PluginBundleView,
  PluginRowView,
  PluginsListResponse,
  PluginToggleBody,
  PluginToggleResponse,
} from './plugins.types'
import { ArchiveRequestError } from './archive'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

/**
 * 官方 `plugin-manager` 的公开契约在本地的最小镜像（官方包 external，不能 import 类型）。
 *
 * 只声明我们真正会调的方法：多写不用到的方法会随官方演进变脆。
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

/** 官方 `PluginLocalizedMeta` 的最小镜像；三个字段都可能是任何漂移后的形状，投影时逐个校验。 */
export interface OfficialLocalizedMeta {
  title?: LocalizedTextView
  description?: LocalizedTextView
  icon?: string
  /** 官方在这里放加载失败的文案；v2 不透出（机器码走 `BundleInfo.error.code`）。 */
  error?: string
}

/** 官方 `BundleRowInfo`：包自带 patch 的一行。 */
export interface OfficialBundleRowInfo {
  rowId: string
  moduleName: string
  /** 包被停用（或行没挂上）时缺失。 */
  entryId?: string
}

/** 官方 `BundleInfo` 的最小镜像。`description` 是 manifest 原文，未本地化。 */
export interface OfficialBundleInfo {
  name: string
  official: boolean
  installed: boolean
  enabled: boolean
  /** `installation` | `profile` | `missing`。 */
  availability: string
  version?: string
  meta?: OfficialLocalizedMeta
  description?: string
  readOnlyReason?: string
  error?: { code?: string }
  rows: OfficialBundleRowInfo[]
}

export interface OfficialChangeResult {
  changed: boolean
  application: string
  error?: { code?: string, diagnostic?: string }
}

export interface PluginManagerService {
  listPlugins: () => Promise<OfficialPluginInfo[]>
  setPluginEnabled: (entryId: string, enabled: boolean) => Promise<OfficialChangeResult>
  listBundles: () => Promise<OfficialBundleInfo[]>
  setBundleEnabled: (name: string, enabled: boolean) => Promise<OfficialChangeResult>
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
 * 图标透传上限 64 KiB。
 *
 * 官方允许 256 KiB 的 base64 图标；二十多个包全带上会把响应撑到几 MB，而页面只是画一个方形缩略图。
 * base64 是纯 ASCII，字符数即字节数，所以直接比 `length`。
 */
const ICON_MAX_LENGTH = 64 * 1024

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
 *
 * 四个方法都在才算可用：2.2.0 的包级清单/启停依赖 `listBundles` / `setBundleEnabled`，
 * 缺任一方法说明宿主是老版本，此时回 503 比抛 `is not a function` 更有用。
 */
export function resolvePluginManager(ctx: HostServiceHub): PluginManagerService | undefined {
  const candidate = readService(ctx, 'pluginManager')
  if (candidate === null || typeof candidate !== 'object')
    return undefined
  const manager = candidate as PluginManagerService
  return typeof manager.listPlugins === 'function'
    && typeof manager.setPluginEnabled === 'function'
    && typeof manager.listBundles === 'function'
    && typeof manager.setBundleEnabled === 'function'
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
  return projectPluginRows(await manager.listPlugins())
}

/** `listPluginRows` 的纯投影部分：`listBundles` 的 join 复用同一份结果，保证两处口径一致。 */
function projectPluginRows(raw: unknown): PluginRowView[] {
  if (!Array.isArray(raw))
    return []
  const projected: PluginRowView[] = []
  for (const item of raw) {
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

/**
 * `LocalizedText` 原样透传，只挡非字符串值。
 *
 * **不**在宿主端解析语言：`ctx.locale.resolveText()` 在客户端，且用户切换语言时宿主缓存的那份就过期了。
 */
function toLocalizedText(value: unknown): LocalizedTextView | undefined {
  if (typeof value === 'string')
    return value
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const normalized: Record<string, string> = {}
  for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === 'string')
      normalized[locale] = text
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * 包自带的行 → 线协议行。
 *
 * 有 `entryId` 才 join 回 `listPlugins()` 的结果补状态；没有 `entryId`（包被整体停用，行没挂上）
 * 时 `enabled:false` / `fiberPhase:null` 且**不带** `patchId`——没有存活条目就没有可写的 patch 行，
 * 页面据此不给开关（v1 的判据就是「有 patchId 才可点」）。join 落空时走同一分支。
 */
function projectBundleRows(raw: unknown, byEntryId: Map<string, PluginRowView>): PluginBundleRowView[] {
  if (!Array.isArray(raw))
    return []
  const rows: PluginBundleRowView[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object')
      continue
    const row = item as OfficialBundleRowInfo
    if (typeof row.rowId !== 'string' || typeof row.moduleName !== 'string')
      continue
    const view: PluginBundleRowView = {
      rowId: row.rowId,
      moduleName: row.moduleName,
      enabled: false,
      fiberPhase: null,
    }
    if (typeof row.entryId === 'string') {
      view.entryId = row.entryId
      const live = byEntryId.get(row.entryId)
      if (live !== undefined) {
        view.enabled = live.enabled
        view.fiberPhase = live.fiberPhase
        if (live.patchId !== undefined)
          view.patchId = live.patchId
        if (live.readOnlyReason !== undefined)
          view.readOnlyReason = live.readOnlyReason
      }
    }
    rows.push(view)
  }
  return rows
}

/**
 * 一个官方包 → 线协议包；形状不对返回 `undefined`（由调用方跳过）。
 *
 * 跳过而不是抛错：一包坏数据不该让整个「插件」页 500——v1 的行投影就是这个姿态。
 */
function projectBundle(item: unknown, byEntryId: Map<string, PluginRowView>): PluginBundleView | undefined {
  if (item === null || typeof item !== 'object')
    return undefined
  const bundle = item as OfficialBundleInfo
  // 必需字段里只有 `name` / `availability` 参与定位与状态渲染；`rows` 允许缺失（patch 读不出来时官方也可能不回）。
  if (typeof bundle.name !== 'string' || bundle.name === '')
    return undefined
  if (typeof bundle.availability !== 'string')
    return undefined
  const view: PluginBundleView = {
    name: bundle.name,
    official: bundle.official === true,
    installed: bundle.installed === true,
    enabled: bundle.enabled === true,
    availability: bundle.availability,
    rows: projectBundleRows(bundle.rows, byEntryId),
  }
  if (typeof bundle.version === 'string')
    view.version = bundle.version
  const title = toLocalizedText(bundle.meta?.title)
  if (title !== undefined)
    view.title = title
  const description = toLocalizedText(bundle.meta?.description)
  if (description !== undefined)
    view.description = description
  // 图标只在不超过上限时透传：超了宁可退回客户端的内置图标，也不要让整页响应变成几 MB。
  if (typeof bundle.meta?.icon === 'string' && bundle.meta.icon.length <= ICON_MAX_LENGTH)
    view.icon = bundle.meta.icon
  // manifest 原文留作「没有本地化文案」时的兜底，字段名区分开免得页面把两种文案混用。
  if (typeof bundle.description === 'string')
    view.manifestDescription = bundle.description
  if (typeof bundle.readOnlyReason === 'string')
    view.readOnlyReason = bundle.readOnlyReason
  if (typeof bundle.error?.code === 'string')
    view.errorCode = bundle.error.code
  return view
}

/** 第三方在前、官方在后，各自按包名升序：用户要管的就是那几个第三方包，官方包会把它淹掉。 */
function compareBundles(a: PluginBundleView, b: PluginBundleView): number {
  if (a.official !== b.official)
    return a.official ? 1 : -1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * 一次 `listPlugins()` + 一次 `listBundles()` 之后 join 出「包 + 条目」双清单。
 *
 * 为什么只调一次 `listPlugins()`：扁平清单与 bundle 行的状态必须来自同一份快照，
 * 否则会出现「包里的行说启用、上方计数说停用」这种自相矛盾的响应。
 */
async function loadInventory(manager: PluginManagerService): Promise<PluginsListResponse> {
  const plugins = projectPluginRows(await manager.listPlugins())
  const byEntryId = new Map(plugins.map(row => [row.entryId, row]))
  const rawBundles = await manager.listBundles()
  const bundles: PluginBundleView[] = []
  if (Array.isArray(rawBundles)) {
    for (const item of rawBundles) {
      const view = projectBundle(item, byEntryId)
      if (view !== undefined)
        bundles.push(view)
    }
  }
  // 排序放宿主：客户端只做筛选与渲染，两处都排会漂移。
  bundles.sort(compareBundles)
  return { bundles, plugins }
}

/** 页面主视图：包级清单（已排序）。 */
export async function listPluginBundles(manager: PluginManagerService): Promise<PluginBundleView[]> {
  return (await loadInventory(manager)).bundles
}

/** 双清单：包 + 扁平条目。页面用后者计数与搜索，不铺开渲染。 */
export async function listPluginInventory(manager: PluginManagerService): Promise<PluginsListResponse> {
  return loadInventory(manager)
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

/**
 * 启停一个包（整包进 / 出 profile 的 `dsh.profile.bundles`）。
 *
 * 与行级共用 `toToggleResponse`：两种启停的 `application` 语义完全一样，各自实现一份必然漂移。
 * 硬拒绝只多一条「停用自己」——包名就是权威标识，不用先 `listBundles()` 反查；
 * 其余判定（`readOnlyReason` / `bundle-in-use` / `stop-profile`）交给官方，它自己会回码。
 */
export async function toggleBundle(
  manager: PluginManagerService,
  name: string,
  enabled: boolean,
): Promise<PluginToggleResponse> {
  if (enabled === false && name === SELF_MODULE) {
    throw new PluginRequestError(
      PLUGIN_SELF_MANAGEMENT,
      'dsh-toolshed cannot disable its own bundle: the panel would disappear immediately and there is no way back from the UI',
    )
  }
  return toToggleResponse(await manager.setBundleEnabled(name, enabled))
}

export interface PluginsAdmin {
  /** 双清单：包级主视图 + 扁平 Loader 条目（本机实测 227 条，筛选放在页面搜索框）。 */
  list: () => Promise<PluginsListResponse>
  toggle: (body: PluginToggleBody) => Promise<PluginToggleResponse>
  toggleBundle: (body: PluginBundleToggleBody) => Promise<PluginToggleResponse>
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
    list: async () => listPluginInventory(managerOrThrow()),
    toggle: async body => togglePlugin(managerOrThrow(), body.entryId, body.enabled),
    toggleBundle: async body => toggleBundle(managerOrThrow(), body.name, body.enabled),
  }
}
