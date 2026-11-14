/**
 * 「插件」tab 的线协议类型。
 *
 * 为什么和服务放在一起（照 `archive.types.ts` 的先例）：服务层的判定逻辑要能脱离 DSH 单测，
 * 类型跟着服务走；`routes/index.types.ts` 只再导出一份，客户端 `apis/index.type.ts` 也是再导出——
 * 全仓只有这一份定义，改字段只改这一个文件。
 *
 * 这些形状是**官方 `pluginManager` 服务 `listPlugins()` / `listBundles()` / `setPluginEnabled()` /
 * `setBundleEnabled()` 的投影**，不是我们自己发明的模型：字段名与官方一致，是为了排查时能和官方
 * 「插件」页的返回逐字对上。
 *
 * 2.2.0 起以**包（bundle）**为主视图：`listPlugins()` 列的是 Loader 条目（本机 227 条，绝大多数是 DSH
 * 自己的内部模块），铺开给人看没法用；官方页的卡片也是包级的，包级才有「图标 + 名称 + 一句话」。
 */

/** `LocalizedText` 的线协议形态：字面量，或按语言 id 索引的映射（官方保证至少有 `en`）。 */
export type LocalizedTextView = string | { readonly [locale: string]: string }

/**
 * 一行 Loader 条目。
 *
 * `patchId` 与 `readOnlyReason` 互斥（官方 `PluginInfo` 就是判别联合）：
 * 有 `patchId` 才可启停，否则给一个原因码。
 */
export interface PluginRowView {
  /** Loader 条目 id（例如 `include:bash-sandbox`）。启停请求用它定位。 */
  entryId: string
  /** 精确模块标识（例如 `@deepseek-ai/dsh-pwsh-sandbox`）。页面展示它。 */
  moduleName: string
  /** Loader 的有效启用状态（含被祖先条目连带禁用的情形）。 */
  enabled: boolean
  /** 存活阶段（`active` / `pending` / `loading` / `failed` / `unloading`）；`null` = 没有存活的根 fiber。 */
  fiberPhase: string | null
  /** 可启停时给：用户 patch 层里唯一定位这一项的那一行的 id。 */
  patchId?: string
  /**
   * 不可启停的原因码：
   * - `management-required`：插件管理本身所需，停掉会拆掉管理能力；
   * - `unaddressable`：当前 profile 的 patch 无法唯一定位这一项。
   */
  readOnlyReason?: string
}

/**
 * 包自带的一条 patch 行。
 *
 * 与 `PluginRowView` 分开：包被停用时它的行没有存活的 Loader 条目，也就没有 `entryId` 可启停，
 * 但仍要在展开里显示出来（否则用户会以为包里的行消失了）。
 */
export interface PluginBundleRowView {
  /** 包自带的 patch 里声明的行 id。 */
  rowId: string
  moduleName: string
  /** 存活的 Loader 条目 id；包被停用时缺失。 */
  entryId?: string
  /** 没有存活条目时恒为 `false`（包整体没在跑）。 */
  enabled: boolean
  fiberPhase: string | null
  patchId?: string
  readOnlyReason?: string
}

/**
 * 一个 npm 包（官方 `BundleInfo` 的投影）。
 *
 * `meta` 的 `title` / `description` **原样透传**：`LocalizedText` 要么是字面量、要么是按语言 id 索引的
 * 映射，宿主端不该猜用户的语言，交给客户端 `ctx.locale.resolveText()` 解析（官方页就是这么做的）。
 */
export interface PluginBundleView {
  /** npm 包名；包级启停请求用它定位。 */
  name: string
  /** 官方维护（随安装包提供，或市场目录条目）；`false` = 这个 profile 自己装的第三方包或本地 link。 */
  official: boolean
  /** profile 的 `package.json` 是否声明了这个依赖。 */
  installed: boolean
  /** 是否已在 profile 的 `dsh.profile.bundles` 组合里。 */
  enabled: boolean
  /** 包文件是否可读：`installation` | `profile` | `missing`。 */
  availability: string
  /** 已安装版本（官方报得出来时）。 */
  version?: string
  /** 本地化标题（官方 `PluginLocalizedMeta.title`）。 */
  title?: LocalizedTextView
  /** 本地化一句话简介（官方 `PluginLocalizedMeta.description`）。 */
  description?: LocalizedTextView
  /** base64 data URL；超过 64 KiB 的一律不透传（图标上限是 256 KiB，二十个包全带上会把响应撑到几 MB）。 */
  icon?: string
  /** 包 manifest 里那段**未本地化**的 `description`，没有本地化文案时兜底。 */
  manifestDescription?: string
  /** 官方给的可管理性原因（有值 = 这一包不能被改）。 */
  readOnlyReason?: string
  /** 包加载失败时的机器码（官方 `ManagementError.code`）。 */
  errorCode?: string
  /** 包自带的 patch 行，按声明顺序；patch 读不出来时为空。 */
  rows: PluginBundleRowView[]
}

export interface PluginsListResponse {
  /** 以包为单位的主视图；宿主已排好序（第三方在前、官方在后，各自按包名升序）。 */
  bundles: PluginBundleView[]
  /**
   * 扁平的 Loader 条目清单（本机 227 条）。
   *
   * 为什么还留着：页面用它的总数说明「为什么有几百个插件」（一个包会带多条条目），
   * 并让搜索能命中包内的模块名。**不要**再把它铺开渲染成 227 行的列表。
   */
  plugins: PluginRowView[]
}

/** 行级启停。 */
export interface PluginToggleBody {
  entryId: string
  enabled: boolean
}

/** 包级启停。 */
export interface PluginBundleToggleBody {
  name: string
  enabled: boolean
}

/**
 * 启停结果（行级与包级共用）：**原样透出**官方的 `ChangeResult.application`，不做归一化。
 *
 * 为什么不压成 `ok/restartNeeded` 两个布尔：官方有四种真实结局（立即生效 / 需重启 / 被更高优先级
 * patch 覆盖 / 启用后激活失败），压扁之后「被覆盖」会伪装成成功、而「激活失败」时配置文件其实已经写了
 * （`changed: true`）——页面必须能如实说明，并允许撤销。
 */
export interface PluginToggleResponse {
  /** 只有 `applied` / `restart-required` / `overridden` 算成功。 */
  ok: boolean
  /** `applied` | `restart-required` | `overridden` | `failed` | `cancelled`。 */
  application: string
  /** 配置文件是否真的被改了；`failed` 也可能为 `true`。 */
  changed: boolean
  /** `application === 'failed'` 时的机器码（官方的 code 表之一）。 */
  errorCode?: string
  /** 官方给的诊断句；`operation-error` 时信息量最大。 */
  diagnostic?: string
}

/**
 * 服务层自己判定的、**不走官方 code 表**的两种拒绝。路由把它们映射成 HTTP 状态。
 *
 * 为什么不用官方码：这两个是我们替用户挡下的错误（服务没挂 / 想停掉自己），官方服务根本看不到请求。
 */
export const PLUGIN_MANAGER_UNAVAILABLE = 'plugin-manager-unavailable'
export const PLUGIN_SELF_MANAGEMENT = 'self-management'
