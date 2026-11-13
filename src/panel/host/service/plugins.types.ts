/**
 * 「插件」tab 的线协议类型。
 *
 * 为什么和服务放在一起（照 `archive.types.ts` 的先例）：服务层的判定逻辑要能脱离 DSH 单测，
 * 类型跟着服务走；`routes/index.types.ts` 只再导出一份，客户端 `apis/index.type.ts` 也是再导出——
 * 全仓只有这一份定义，改字段只改这一个文件。
 *
 * 这些形状是**官方 `pluginManager` 服务 `listPlugins()` / `setPluginEnabled()` 的投影**，
 * 不是我们自己发明的模型：字段名与官方一致，是为了排查时能和官方「插件」页的返回逐字对上。
 */

/**
 * 一行已安装插件。
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

export interface PluginsListResponse {
  plugins: PluginRowView[]
}

export interface PluginToggleBody {
  entryId: string
  enabled: boolean
}

/**
 * 启停结果：**原样透出**官方的 `ChangeResult.application`，不做归一化。
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
  /** `application === 'failed'` 时的机器码（官方的 11 个 code 之一）。 */
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
