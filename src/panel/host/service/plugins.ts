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
 * 只投影 `listBundles()`（npm 包）：官方的 `listPlugins()` 列的是 Loader 条目（本机 227 条，
 * `dsh-base` 一包就 87 条），那是实现细节、不是「我装了什么」；条目级的精细开关留给官方「插件」页。
 * 所以这里既不请求也不透出条目，包级启停是唯一写入口。
 */
import type { HostServiceHub } from './archive'
import type {
  LocalizedTextView,
  PluginBundleToggleBody,
  PluginBundleView,
  PluginsListResponse,
  PluginToggleResponse,
} from './plugins.types'
import { ArchiveRequestError } from './archive'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

/** 官方 `PluginLocalizedMeta` 的最小镜像；三个字段都可能是任何漂移后的形状，投影时逐个校验。 */
export interface OfficialLocalizedMeta {
  title?: LocalizedTextView
  description?: LocalizedTextView
  icon?: string
  /** 官方在这里放加载失败的文案；不透出（机器码走 `BundleInfo.error.code`）。 */
  error?: string
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
}

export interface OfficialChangeResult {
  changed: boolean
  application: string
  error?: { code?: string, diagnostic?: string }
}

/**
 * 官方 `plugin-manager` 的公开契约在本地的最小镜像（官方包 external，不能 import 类型）。
 *
 * 只声明我们真正会调的两个方法：多写不用到的方法会随官方演进变脆，也会让老宿主被误判成不可用。
 */
export interface PluginManagerService {
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

/** 我们自己这个包的名字：停它等于当场拆掉本面板。包名是权威标识，不用先 listBundles() 反查。 */
const SELF_BUNDLE = 'dsh-toolshed'

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
 * 两个方法都在才算可用：缺任一说明宿主是老版本（包级清单/启停是 0.2.2+ 才有），
 * 此时回 503 比抛 `is not a function` 更有用。
 */
export function resolvePluginManager(ctx: HostServiceHub): PluginManagerService | undefined {
  const candidate = readService(ctx, 'pluginManager')
  if (candidate === null || typeof candidate !== 'object')
    return undefined
  const manager = candidate as PluginManagerService
  return typeof manager.listBundles === 'function'
    && typeof manager.setBundleEnabled === 'function'
    ? manager
    : undefined
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
 * 一个官方包 → 线协议包；形状不对返回 `undefined`（由调用方跳过）。
 *
 * 跳过而不是抛错：一包坏数据不该让整个「插件」页 500。
 */
function projectBundle(item: unknown): PluginBundleView | undefined {
  if (item === null || typeof item !== 'object')
    return undefined
  const bundle = item as OfficialBundleInfo
  // 必需字段里只有 `name` / `availability` 参与定位与状态渲染。
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
 * 官方「插件」页**没有页面**的包（`@deepseek-ai/dsh-official-bundles` 的 `HIDDEN_BUNDLES` 镜像）。
 *
 * 为什么这里也要藏一遍：官方那层过滤在**页面侧**（`PluginManagerPage` 的 `listed` 计算），
 * 服务端 `listBundles()` 给的是全量。名单里是**别的 profile 模板用的基础组合**
 * （`dsh-base` / `dsh-web-app` / `dsh-headless` / `dsh-sdk-app` / `dsh-sdk-minimal` / `dsh-acp-app`）
 * 加上持久终端与 worktree 工具——它们在官方页里连卡片都没有，在本页出现只会让人以为
 * 「我装了两个 SDK 插件 / 我装了 base」，还会让人去停 `dsh-base` 这种一停就起不来的东西。
 *
 * 官方包一律 external（AGENTS 约束 4），import 不到那个常量，只能镜像这份名单。
 * 代价写在这里：官方**新增**一个会让我们多显示一项（可接受）；官方**改名**会让旧名字重新冒出来
 * ——「我们的列表里有官方页没有的包」时，先来这里对一遍。
 */
const NO_PAGE_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-experimental-terminal-bundle',
  '@deepseek-ai/dsh-experimental-tool-worktree',
])

/**
 * 页面主视图：一次 `listBundles()` 投影 + 排序。
 *
 * 排序放宿主：客户端只做筛选与渲染，两处都排会漂移。
 * 过滤也放宿主：README 描述的可见集就是「官方页能看到的那些包」，客户端再筛会两处口径不一。
 */
export async function listPluginBundles(manager: PluginManagerService): Promise<PluginBundleView[]> {
  const raw = await manager.listBundles()
  const bundles: PluginBundleView[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const view = projectBundle(item)
      if (view !== undefined && !NO_PAGE_BUNDLES.has(view.name))
        bundles.push(view)
    }
  }
  bundles.sort(compareBundles)
  return bundles
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
 * 启停一个包（整包进 / 出 profile 的 `dsh.profile.bundles`）。
 *
 * 判定顺序：先自管理硬拒绝（官方保护集里没有本插件，技术上可被自己停掉，停完面板当场消失且没有
 * 恢复入口），再把请求交给官方服务；拒绝前不调官方。
 *
 * 官方对 `readOnlyReason` / `bundle-in-use` / `stop-profile` / 写盘失败一律**不抛异常**、回
 * `application:'failed'` + `error.code`，所以这里不替它预判：让官方的拒绝原样回到页面，
 * 只有一份事实来源。
 */
export async function toggleBundle(
  manager: PluginManagerService,
  name: string,
  enabled: boolean,
): Promise<PluginToggleResponse> {
  if (enabled === false && name === SELF_BUNDLE) {
    throw new PluginRequestError(
      PLUGIN_SELF_MANAGEMENT,
      'dsh-toolshed cannot disable its own bundle: the panel would disappear immediately and there is no way back from the UI',
    )
  }
  return toToggleResponse(await manager.setBundleEnabled(name, enabled))
}

export interface PluginsAdmin {
  /** 包级主视图（已排序）。 */
  list: () => Promise<PluginsListResponse>
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
    list: async () => ({ bundles: await listPluginBundles(managerOrThrow()) }),
    toggleBundle: async body => toggleBundle(managerOrThrow(), body.name, body.enabled),
  }
}
