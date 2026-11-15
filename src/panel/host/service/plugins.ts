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
  PluginInspectAccepted,
  PluginInspectBody,
  PluginInspectResponse,
  PluginInstallBody,
  PluginInstallResponse,
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
 * 官方 `PackageResult` 里与「为什么失败」有关的字段。
 *
 * `kind` 是官方对最后一次 pnpm 运行的分类（`build-blocked` / `network` / `not-found` …），页面要靠它
 * 决定是「让用户点允许构建」还是「提示换源」；`output` 是唯一能给出原话的线索。
 */
export interface OfficialInstallPackageResult {
  kind?: string
  output?: string
  /** 官方已按自己的上限截过一遍；我们这里再截到 8 KiB（见 `INSTALL_OUTPUT_MAX_LENGTH`）。 */
  truncated?: boolean
  /** 兼容性 / `expected` 校验的拒绝原因（`unexpected-package` | `not-bundle`）。 */
  unmet?: string
  exitCode?: number
  timedOut?: boolean
  logPath?: string
}

/** 官方 `ChangeResult` 里安装专有、启停用不到的那几个字段。 */
export interface OfficialInstallChangeResult extends OfficialChangeResult {
  /** 装成功的包名与 manifest 版本：官方装完才报得出来（`inspect` 读到的是最新发布，可能不一样）。 */
  bundle?: string
  version?: string
  /** 非空 = 有安装脚本等用户显式批准，**这一轮什么都没装**。 */
  pendingBuilds?: string[]
  packageResult?: OfficialInstallPackageResult
}

/**
 * 官方 `PluginSpecInspection` 的最小镜像。
 *
 * 只列我们真正读的字段：`registry` / `host` / `registries` 是诊断用的，页面不显示，
 * 声明过来只会多一份会漂移的形状。
 */
export interface OfficialSpecInspection {
  status?: string
  kind?: string
  name?: string
  version?: string
  description?: string
  bundle?: boolean | null
  problem?: string
  reason?: string
}

/** 官方 `InstallBundleOptions` 里我们透传的两项（其余由官方默认值决定）。 */
export interface OfficialInstallBundleOptions {
  approvedBuilds?: string[]
  registry?: string | null
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

/**
 * 安装能力（官方 `inspect()` / `installBundle()`）的最小契约。
 *
 * 为什么和 `PluginManagerService` 分开而不是加在一起：启停在 0.2.2 就有了，安装要更新的宿主；
 * 合成一个接口会让老宿主连「启停」都判成不可用——那就把这个 tab 唯一能用的功能也一起拿掉了。
 * 两个能力各自按需解析，缺哪个只影响用到它的那条路由。
 *
 * 返回值一律 `unknown`：官方包 external 拿不到类型，而投影层必须假定形状会漂移（逐字段校验）。
 */
export interface PluginInstallerService {
  inspect: (spec: string) => Promise<unknown>
  installBundle: (spec: string, options?: OfficialInstallBundleOptions) => Promise<unknown>
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
 * 安装输出只回**尾部** 8 KiB。
 *
 * pnpm 的原话在最后几十行（`ERR_PNPM_*` 与退出原因），而一次安装的输出可以是几百 KiB；
 * 整段回传会把响应撑大，页面也只展示一个可滚动的详情框。
 */
const INSTALL_OUTPUT_MAX_LENGTH = 8 * 1024

/** 截断说明放在输出**前面**：页面从上往下渲染，用户第一眼就该知道「这段不是完整的」。 */
const INSTALL_OUTPUT_TRUNCATED = `[dsh-toolshed] pnpm output truncated: showing the last ${INSTALL_OUTPUT_MAX_LENGTH} characters`

/**
 * 官方答复的形状我们认不出来时的兜底说明。
 *
 * 宁可显示「检查不了」，也不要把读不懂的答复画成「可以装」——后者会把用户带进一次注定失败的安装。
 */
const UNRECOGNISED_RESULT = 'the pluginManager answered a result this panel does not recognise'

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
 * 惰性解析同一个 `pluginManager` 的**安装**能力。
 *
 * 与 `resolvePluginManager` 是两份独立的契约：老宿主可能只有启停没有安装，反过来也不成立，
 * 所以各自只认自己用的两个方法。同样是请求期按名字取、不进 `inject`（理由见上一条）。
 */
export function resolvePluginInstaller(ctx: HostServiceHub): PluginInstallerService | undefined {
  const candidate = readService(ctx, 'pluginManager')
  if (candidate === null || typeof candidate !== 'object')
    return undefined
  const installer = candidate as PluginInstallerService
  return typeof installer.inspect === 'function'
    && typeof installer.installBundle === 'function'
    ? installer
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

/** 只认真正的普通对象：数组 / null / 原始值在投影里一律当「形状不对」。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 官方 `inspect()` 的答复 → 线协议。
 *
 * 只搬页面真正要用的六个字段（`status/kind/name/version/description/bundle`）；
 * `registry` / `host` / `registries` 是诊断用的，页面不显示，搬过去只会多一份会漂移的字段。
 *
 * 形状不对的单字段直接跳过，整体仍然返回：一次检查的答复坏掉不该让页面卡在「检查中」。
 */
export function toInspectResponse(raw: unknown): PluginInspectResponse {
  const inspection = isRecord(raw) ? (raw as OfficialSpecInspection) : undefined
  if (inspection?.status === 'accepted' && typeof inspection.kind === 'string' && inspection.kind !== '') {
    const accepted: PluginInspectAccepted = {
      status: 'accepted',
      kind: inspection.kind,
      // 官方语义：`null` = 这种 spec 形式判断不了有没有 bundle（git / tarball 要装完才知道）。
      // 读不出布尔值时也用 `null`，不猜 true/false——猜错会让页面提前承诺「这是插件包」。
      bundle: typeof inspection.bundle === 'boolean' ? inspection.bundle : null,
    }
    if (typeof inspection.name === 'string' && inspection.name !== '')
      accepted.name = inspection.name
    if (typeof inspection.version === 'string' && inspection.version !== '')
      accepted.version = inspection.version
    if (typeof inspection.description === 'string')
      accepted.description = inspection.description
    return accepted
  }
  // 走到这里要么是 refused，要么是认不出的形状（含非对象、少了 kind 的 accepted）：
  // 一律按「拒绝」回，页面会如实显示原因，而不是把一个读不懂的答复画成「检查通过」。
  const problem = typeof inspection?.problem === 'string' && inspection.problem !== ''
    ? inspection.problem
    : 'unknown'
  const reason = typeof inspection?.reason === 'string' && inspection.reason !== ''
    ? inspection.reason
    : UNRECOGNISED_RESULT
  return { status: 'refused', problem, reason }
}

/** 输出尾部 8 KiB；超了在前面加一行截断说明（页面从上往下渲染，先说清「这不是完整的」）。 */
function outputTail(output: string): string {
  if (output.length <= INSTALL_OUTPUT_MAX_LENGTH)
    return output
  return `${INSTALL_OUTPUT_TRUNCATED}\n${output.slice(-INSTALL_OUTPUT_MAX_LENGTH)}`
}

/**
 * 官方 `installBundle()` 的 `ChangeResult` → 线协议。
 *
 * 与启停同一套 `application` 语义（官方也可能**不抛异常**把失败放进结果里），所以这里同样只判
 * `application`。区别是安装失败需要更多线索：`failureKind` 用来分支（要不要请用户批准构建脚本），
 * `output` 是用户唯一能看到的 pnpm 原话。
 */
export function toInstallResponse(raw: unknown): PluginInstallResponse {
  // 走 `unknown` 中转才转得动：两者没有足够的重叠字段（官方形状只是镜像，不能当真）。
  const result: OfficialInstallChangeResult | undefined = isRecord(raw)
    ? (raw as unknown as OfficialInstallChangeResult)
    : undefined
  const application = typeof result?.application === 'string' ? result.application : 'failed'
  const response: PluginInstallResponse = {
    ok: OK_APPLICATIONS.has(application),
    application,
    changed: result?.changed === true,
  }
  const error = isRecord(result?.error) ? result.error : undefined
  if (typeof error?.code === 'string')
    response.errorCode = error.code
  const packageResult = isRecord(result?.packageResult) ? result.packageResult : undefined
  if (typeof packageResult?.kind === 'string')
    response.failureKind = packageResult.kind
  if (typeof result?.bundle === 'string')
    response.bundle = result.bundle
  if (typeof result?.version === 'string')
    response.version = result.version
  if (Array.isArray(result?.pendingBuilds)) {
    const pending = result.pendingBuilds.filter((name): name is string => typeof name === 'string' && name !== '')
    // 空数组不透出：只有非空才意味着「这一轮什么都没装，等用户批准」；
    // 透出空数组会让页面弹一个没有内容的确认框。同样也挡掉杂物项，免得页面渲染出 undefined。
    if (pending.length > 0)
      response.pendingBuilds = pending
  }
  const output = typeof packageResult?.output === 'string' ? outputTail(packageResult.output) : undefined
  if (output !== undefined)
    response.output = output
  if (typeof error?.diagnostic === 'string' && error.diagnostic !== '') {
    response.diagnostic = error.diagnostic
  }
  // 失败却没有 diagnostic：用输出尾部兜底（二选一，不拼接）——否则页面只剩一个机器码，用户看不到
  // pnpm 到底说了什么。成功时不做这件事，免得一条顺利的安装也带一句没人看的「诊断」。
  else if (!response.ok && output !== undefined) {
    response.diagnostic = output
  }
  return response
}

export interface PluginsAdmin {
  /** 包级主视图（已排序）。 */
  list: () => Promise<PluginsListResponse>
  toggleBundle: (body: PluginBundleToggleBody) => Promise<PluginToggleResponse>
  /** 安装前检查：装了没、是什么形式、是不是 bundle。**不装任何东西**。 */
  inspect: (body: PluginInspectBody) => Promise<PluginInspectResponse>
  /** 安装：需要批准构建脚本时会回 `pendingBuilds` 且这一轮什么都没装。 */
  install: (body: PluginInstallBody) => Promise<PluginInstallResponse>
}

/**
 * 把请求体缩成官方 `InstallBundleOptions`。
 *
 * 只在真有内容时带字段：官方的默认值已经覆盖 `enabled: true` / 非 exact 保存 / 用配置的源；
 * 空的 `approvedBuilds` 传过去只会让官方多一次「这些名字还在待批准里吗」的判断。
 */
function installOptionsOf(body: PluginInstallBody): OfficialInstallBundleOptions | undefined {
  const options: OfficialInstallBundleOptions = {}
  if (Array.isArray(body?.approvedBuilds) && body.approvedBuilds.length > 0)
    options.approvedBuilds = [...body.approvedBuilds]
  if (typeof body?.registry === 'string' && body.registry !== '')
    options.registry = body.registry
  return Object.keys(options).length > 0 ? options : undefined
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
  // 安装能力单独判：缺的只是「新一点的宿主」，同一个服务名要给出更准的一句话，
  // 否则用户看到「服务没挂上」而列表其实好好的，只会以为是面板坏了。
  const installerOrThrow = (): PluginInstallerService => {
    const installer = resolvePluginInstaller(ctx)
    if (installer === undefined) {
      throw new PluginRequestError(
        PLUGIN_MANAGER_UNAVAILABLE,
        'the pluginManager service in this dsh build cannot inspect or install packages',
      )
    }
    return installer
  }
  return {
    list: async () => ({ bundles: await listPluginBundles(managerOrThrow()) }),
    toggleBundle: async body => toggleBundle(managerOrThrow(), body.name, body.enabled),
    inspect: async body => toInspectResponse(await installerOrThrow().inspect(body.spec)),
    install: async body => toInstallResponse(
      await installerOrThrow().installBundle(body.spec, installOptionsOf(body)),
    ),
  }
}
