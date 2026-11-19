/**
 * 「插件」tab 的线协议类型。
 *
 * 为什么和服务放在一起（照 `archive.types.ts` 的先例）：服务层的判定逻辑要能脱离 DSH 单测，
 * 类型跟着服务走；`routes/index.types.ts` 只再导出一份，客户端 `apis/index.type.ts` 也是再导出——
 * 全仓只有这一份定义，改字段只改这一个文件。
 *
 * 这些形状是**官方 `pluginManager` 服务 `listBundles()` / `setBundleEnabled()` 的投影**，
 * 不是我们自己发明的模型：字段名与官方一致，是为了排查时能和官方「插件」页的返回逐字对上。
 *
 * 2.3.0 的取舍：这个 tab **只讲包**。官方的 `listPlugins()` 列的是 Loader 条目（本机 227 条，
 * `dsh-base` 一包就 87 条），那是实现细节、不是「我装了什么」；条目级的精细开关留给官方「插件」页。
 * 所以这里既没有 `plugins` 也没有 `rows` —— 少两个字段就少一份会漂移的语义。
 */

/** `LocalizedText` 的线协议形态：字面量，或按语言 id 索引的映射（官方保证至少有 `en`）。 */
export type LocalizedTextView = string | { readonly [locale: string]: string }

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
  /**
   * 这一包**怎么更新**（官方 `BundleInfo.update`）：`registry`（按 registry 版本号更新）/
   * `git`（需要调用方给一个钉到 full commit 的 git spec）；缺省 = 根本不能更新
   * （`link:` / 本地路径依赖就是这种，比如 `dsh-toolshed` 自己）。
   */
  update?: string
  /**
   * 官方 `BundleInfo.removable`：这一包能不能**卸载**。
   *
   * 官方口径：profile 自己装的依赖（`owned`）或「只在组合里、没有依赖」的可选包才可移除；随安装包提供的
   * 官方包永远是 `false`。缺省/`false` 时页面**不渲染**卸载入口——否则按钮点下去只会拿到 `not-removable`。
   */
  removable?: boolean
}

export interface PluginsListResponse {
  /** 以包为单位的主视图；宿主已排好序（第三方在前、官方在后，各自按包名升序）。 */
  bundles: PluginBundleView[]
}

/** 包级启停。 */
export interface PluginBundleToggleBody {
  name: string
  enabled: boolean
}

/**
 * 安装前的检查请求。
 *
 * `spec` 就是 pnpm 认的那种安装规格：`name`、`name@1.2.3`、`git+https://…`、本地路径、tarball URL。
 * 官方 `pluginManager.inspect()` 负责判断它是什么、装了没有、是不是一个 bundle。
 */
export interface PluginInspectBody {
  spec: string
}

/** 检查通过：能装，且尽量提前告诉用户装的是什么。 */
export interface PluginInspectAccepted {
  status: 'accepted'
  /** `registry` | `path` | `git` | `tarball`。 */
  kind: string
  /** 只有 registry / path 这种能提前读到 manifest 的形式才有包名与版本。 */
  name?: string
  version?: string
  /** 包 manifest 里的一句话简介。 */
  description?: string
  /** 包是否声明了 `dsh.bundle`；`null` = 这种 spec 形式判断不了（git / tarball 要装完才知道）。 */
  bundle: boolean | null
}

/** 检查拒绝：**还没装任何东西**，原因原样带回去。 */
export interface PluginInspectRefused {
  status: 'refused'
  /** `invalid-spec` | `already-installed` | `not-found` | `not-a-package` | `not-a-bundle` | `network` | `unknown`。 */
  problem: string
  /** pnpm / registry / 文件系统给的原话。 */
  reason: string
}

export type PluginInspectResponse = PluginInspectAccepted | PluginInspectRefused

/** 安装请求。 */
export interface PluginInstallBody {
  spec: string
  /**
   * 用户已确认允许这些包的**安装脚本**（构建脚本）执行。
   *
   * 为什么需要两轮：第一轮官方会返回 `pendingBuilds`（哪些包有要跑的脚本）且**不装**，
   * 页面把它们列给用户看，用户点「允许并继续」后带这个字段再调一次。
   */
  approvedBuilds?: string[]
  /** 首选 registry；不填就用官方配置的那个（官方还会按顺序回退到备选）。 */
  registry?: string
}

/**
 * 安装结果：官方 `ChangeResult` 里与「装包」相关的部分，外加两条诊断线索。
 *
 * 与启停共用 `application` 语义（`applied` / `restart-required` / …），但那三条不足以描述安装失败：
 * 用户需要知道**是网络、是包不存在、还是要跑构建脚本却没被批准**，所以额外带 `failureKind` 与 `output`。
 */
export interface PluginInstallResponse {
  ok: boolean
  application: string
  changed: boolean
  errorCode?: string
  diagnostic?: string
  /**
   * 失败种类：`pnpm-missing` | `timeout` | `not-found` | `no-matching-version` | `network` |
   * `disk-full` | `permission` | `build-blocked` | `integrity` | `unknown`。
   */
  failureKind?: string
  /** 装成功的包名与版本（官方装完才报得出来）。 */
  bundle?: string
  version?: string
  /**
   * 需要用户显式批准才能继续的安装脚本。
   *
   * 非空 = 这一轮**什么都没装**，用户点「允许并继续」后带 `approvedBuilds` 再来一次。
   */
  pendingBuilds?: string[]
  /** pnpm 输出的**尾部**（宿主截断到 8 KiB）：失败时这是唯一能定位原因的线索。 */
  output?: string
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

/** 批量检查更新的请求：只查这些包（客户端只传 `update === 'registry'` 的那些）。 */
export interface PluginUpdateCheckBody {
  names: string[]
}

/** 一个「比已装版本更新」的候选版本（官方 `PluginVersion` 的投影，只留展示需要的）。 */
export interface PluginUpdateCandidateView {
  version: string
  /** registry 给的发布时间（ISO 8601）。 */
  publishedAt?: string
}

/**
 * 一个包的检查结果。
 *
 * `status: 'listed'` 是「问到了」；`latest` 缺失表示**确实没有可用更新**（不是失败）。
 * `status: 'refused'` 才表示没问到（离线 / 不是可更新的包 / 非 registry 依赖），
 * 原因在 `problem` / `reason` 里——页面据此区分「已是最新」和「检查失败」。
 */
export interface PluginUpdateCheckView {
  name: string
  /** `listed` | `refused`。 */
  status: string
  /** 当前装的版本（检查就是比它新）。 */
  installed?: string
  /** 官方口径挑出的最新可用版本；没有则这一包已是最新。 */
  latest?: PluginUpdateCandidateView
  /** 回答的 registry（更新时要把它传给 host，才会从同一个源装）。 */
  registry?: string | null
  /** 还有多少个更新的版本因为上限没列出来。 */
  omitted?: number
  /** `refused` 时的机器码：`not-updatable` | `not-found` | `network` | `unknown`。 */
  problem?: string
  /** `refused` 时的原话（registry / pnpm 说的）。 */
  reason?: string
}

export interface PluginUpdateCheckResponse {
  checks: PluginUpdateCheckView[]
}

/** 执行更新：必须带上检查时给出的版本与 registry（否则可能从另一个源装到别的版本）。 */
export interface PluginUpdateBody {
  name: string
  version: string
  /** 检查时回答的那个 registry；缺省由官方按它自己的顺序重试。 */
  registry?: string
}

/**
 * 更新结果：官方 `PluginUpdateResult` 的投影。
 *
 * 更新是**先卸旧版再装新版**：`result` 是最后执行的那一步的结果，`restore` 只在「新版装失败/被取消、
 * 又把旧版装回去」时出现——页面必须如实说出这件事（用户会看到一个中间态失败但版本没变）。
 */
export interface PluginUpdateResponse {
  /** 只有 `result.ok` 为真才算整体成功。 */
  ok: boolean
  /** 更新前 / 目标版本。 */
  from?: string
  to?: string
  /** 最后执行的步骤：`check` | `remove` | `install`。 */
  step?: string
  /** 该步骤的结果（与安装共用同一套投影字段）。 */
  result?: PluginInstallResponse
  /** 失败后把旧版装回去的结果。 */
  restore?: PluginInstallResponse
}

/** 卸载一个包（官方 `removeBundle`）。 */
export interface PluginRemoveBody {
  name: string
}

/**
 * 卸载结果：与安装共用同一套投影。
 *
 * 官方 `removeBundle` 的语义要注意：**已启用的会先被取消选中**，再走 `pnpm remove`，最后 reload；
 * 「只在组合里、没有依赖」的可选包则只是取消选中（`installed: false` 时不会再跑 pnpm）。
 */
export type PluginRemoveResponse = PluginInstallResponse
