# Changelog

## [2.6.1] — 2026-11-15

### Removed

- **重启控件左边的刷新按钮**。安全闸在 2.6.0 去掉之后，它唯一的作用是让「重启会中断什么」那句提示保持新鲜，
  已经不值得占一个按钮。现在改成**点「重启服务」时现读一次** `GET /api/host/restart`：确认弹窗打开时看到的
  就是当下的实情。顺手让读失败时**保留上一次结果**——一次网络抖动不该把按钮变灰、让人以为自己不能重启。

## [2.6.0] — 2026-11-15

### Changed

- **去掉重启的「安全闸」**。之前只要工作区里有运行中的回合、排队中的输入或 running/stopping 的后台任务，
  重启按钮就**禁用**、`POST /api/host/restart` 回 409 `restart-blocked`。实际体验是「绝大多数时候都点不动」，
  而用户点重启之前本来就已经确认过没有要继续的东西了。现在：
  - 按钮只在**「不是桌面进程」**或**「正在重启」**时禁用；
  - 活跃工作仍然读出来（已归档会话豁免），只用于**如实说明会中断什么**——`title` 与确认弹窗里列成
    「运行中的会话 ×2、后台任务 ×1」；点确认就执行；
  - `RestartStatusResponse` 去掉 `canRestart`，`RestartBlockedError` 与 `restart-blocked` 的 409 映射一并删除。

### Fixed

- **Windows 上重启其实一直是坏的**：`restart.ts` 在 `%` 路径检查里引用了尚在 TDZ 的 `const executable`
  （声明在其后），win32 上必抛 `ReferenceError` → 500。`tsc` 的 TS2448 一直是红的，被当成既有噪声忽略了。
  现在把 `executable` 提到使用之前。

## [2.5.0] — 2026-11-15

### Added

- **「安装插件」弹窗**：插件页右上角原来的「插件市场」按钮改成打开一个安装对话框——输入
  `包名` / `name@1.2.3` / `git+https://…` / 本地路径 / tarball URL → **检查** → **安装**。
  走官方 `pluginManager.inspect()` / `installBundle()`：本插件**不自己跑 pnpm、不自己写 `package.json`**。
  - 需要执行**构建脚本**时官方不会装，而是回 `pendingBuilds`；弹窗列出这些包名，点「允许并继续」带
    `approvedBuilds` 再调一次（两轮审批）。
  - 失败如实展示种类（网络 / 包不存在 / pnpm 缺失 / 脚本未批准 …）+ pnpm 输出尾部（等宽、限高可滚动），
    方便直接贴进 issue。
  - 安装成功只刷新列表、不自动关窗（让用户看到结果）；弹窗底部另给「打开官方插件市场」，浏览/搜索/详情
    仍交给官方页的「发现」tab。
- 宿主新增两条路由：`POST /api/plugins/inspect`（只识别、不改文件）、`POST /api/plugins/install`
  （真的装）；路由行 20 → **22**。`resolvePluginInstaller` 只认 `inspect` / `installBundle` 两个方法，
  与启停用的服务判据分开——老宿主上「不能装」不该连「不能启停」一起坏掉。

### Notes

- **为什么不做成官方「发现」页的复刻**：市场客户端只导出 `apply`（把 `DiscoverSection` 注册进官方页的
  `plugins.tab`），既没有组件也没有 `render()`，复刻一遍会跟着市场索引与详情文档的格式漂移。
  而「输入包名直接装」不需要索引，它只是官方 `installBundle` 的一层壳。
- 安装入口的判据是「**先检查通过才能装**」：`inspect` 不可用（503）时安装按钮不可点——
  宁可少一个入口，也不要在没确认「这是什么包」的情况下让他跑 pnpm。

## [2.4.0] — 2026-11-15

### Added

- **「会话」tab 按工作区分组**：主层级是工作区（组头 = 工作区名 + 会话数 + 该组占用 + 待删除数），
  **组默认折叠**，点开才看到该工作区的会话行；没有工作区信息的会话归「未关联工作区」并压在最底部。
  **勾选不受折叠影响**：全选仍然跨全部工作区（含折叠组），每个组另有一个组内全选，半选状态按组各自计算，
  组头实时显示「已选/总数」。组顺序按工作区名排（固定 `zh-Hans-CN` 排序，避免同一列表在两台机器上顺序不同），
  **组内保持宿主给的顺序**不重排。删除 / 取消归档 / 取消待删除 / 磁盘占用 / 文件数 / 子代理数全部照旧。

### Fixed

- **插件页不再列出「官方页没有页面的包」**：官方那层过滤在页面侧（`HIDDEN_BUNDLES`），服务端 `listBundles()`
  给的是全量，于是本页把 `@deepseek-ai/dsh-sdk-app`、`dsh-sdk-minimal` 这些**别的 profile 模板用的基础组合**
  也列了出来，看着像「装了两个 SDK 插件」。现在宿主侧镜像了同一份名单（`dsh-base` / `dsh-web-app` /
  `dsh-headless` / `dsh-sdk-app` / `dsh-acp-app` / `dsh-sdk-minimal` / 持久终端 bundle / worktree 工具），
  可见集与官方「插件」页一致；其中 `dsh-base` 本来就是一停就起不来的那一层。

## [2.3.0] — 2026-11-15

**「插件」tab 只讲包：不再展示任何 Loader 条目。**

### Changed

- **去掉条目（Loader entry）层**：不再有「展开看包里的条目」、不再有行级开关、不再有「N 个包 · M 个条目」里的条目数。
  卡片就是一张包：图标 + 名称 + 一句话简介 + 版本 + 状态 + 包级开关；计数只写「N 个包」。
  搜索相应收窄到 包名 / 标题 / 简介（不再匹配包内 moduleName / entryId）。
- **删掉行级路由**：`POST /api/plugins/toggle` 与其客户端封装、服务层的 `togglePlugin`、`PluginRowView` /
  `PluginBundleRowView` / `PluginToggleBody` 全部移除；`GET /api/plugins` 只返回 `{ bundles }`
  （`PluginBundleView` 也没有 `rows` 了）。路由行 21 → **20**。
  条目级的精细开关（例如单独停某一个内部模块）回到官方「插件」页——那里本来就逐行列着。

### Fixed

- **侧栏「更多」不再被无条件隐藏（真实事故）**：官方 `SidebarRoot` 的行过滤是
  「固定 + 未被取消固定的」，被**取消固定**的入口只出现在「更多」菜单里、也只能在那儿重新固定，
  而固定状态是**内存态**（刷新才回来）。上一版把「更多」一起藏了，等于把入口关在门后——用户一次误点就丢了
  `dsh-lifehud` 与 `dsh-toolshed` 两个入口。现在只在「渲染出来的行数 ≥ 已注册的 `main` 面板数」
  （= 一个都没被取消固定）时才藏；一旦有入口不见了，「更多」立刻自己回来当回收口。数不出来时保守地不藏。

## [2.2.0] — 2026-11-14

**「插件」tab 改成以包（bundle）为单位 —— 回答「为什么我有两百多个插件」。**

### Changed

- **插件列表改成包级视图**。之前铺开的是官方 `listPlugins()` 的 **Loader 条目**（本机 227 条，其中 `dsh-base`
  一个包就 87 条、`dsh-web-app` 96 条），铺开既分不清也管不过来。现在主视图是 `listBundles()` 的**包**：
  每张卡片一张**图标 + 名称 + 一句话简介 + 版本 + 启停状态**（图标/文案来自官方的本地化展示元数据
  `meta.icon` / `meta.title` / `meta.description`，超过 64 KiB 的图标不透传），包里的 Loader 条目收进**展开**里。
  头部计数写成「N 个包 · M 个条目」，把「227 条 ≠ 227 个插件」这件事摆明。
- **新增 `全部 / 第三方 / 官方` 三档筛选**，默认 **第三方**（判据是官方的 `BundleInfo.official`），
  搜索同时匹配包内模块名与 `entryId`。
- **新增包级启停**：`POST /api/plugins/bundle/toggle` → 官方 `setBundleEnabled()`（写 profile 的
  `dsh.profile.bundles`）。官方包的包级开关在页面上**禁用**（卸载/目录属于官方页），官方包里的**行**仍可单独启停。
  `GET /api/plugins` 返回 `{ bundles, plugins }`；路由行 20 → **21**。
- **tab 顺序改为 技能 / 插件 / 会话 / MCP**（用户明确要求的显式排序；`rows[0]` 仍是技能，默认页不变）。
- **「插件市场」按钮直达官方页的「发现」tab**：先 `pluginNavigation.openList()`（降级 `selectPanel('plugins')`），
  再按 `SegmentedTabs` 的 `${tabsId}-<tabId>` 后缀或标签文本点到 `discover`；官方只暴露 `openList`/`openBundle`
  且都会强制停在「已安装」，所以这一步是 DOM 兜底，命中不到就安静地停在「已安装」。

### Fixed

- **停用 `dsh-toolshed` 自己在两个层级都被拒绝**：行级与包级都回 409 `self-management`。
- 插件页的行级开关重新按 `patchId` + `entryId` **同时**存在才可点：包被停用时它的行没有存活条目，
  现在显示「包停用后该行不可单独启停」而不是一个点了会 `unknown-plugin` 的死开关。

### Notes

- **需要 DSH 0.2.2+**：宿主侧要求官方 `pluginManager` 同时具备 `listPlugins` / `setPluginEnabled` / `listBundles` /
  `setBundleEnabled` 四个方法，更老的宿主整 tab 回 503 `plugin-manager-unavailable`（页面如实说明，不装空清单）。

## [2.1.0] — 2026-11-13

### Added

- **第四个 tab「插件」**：当前 profile 已加载插件的清单（模块名 / `entryId` / 启停状态 / 存活阶段）+ 搜索 +
  **行级启用 / 停用**。宿主新增两条路由：`GET /api/plugins`（清单）、`POST /api/plugins/toggle`（启停）——
  路由行 18 → **20**。
- 启停复用**官方 `pluginManager` 服务**（`listPlugins` / `setPluginEnabled`），不自己写 `cordis.patch.yml`：
  官方那层已经保证「保留注释与 `!!js` 表达式 + 原子写 + 文件锁」。结果原样透出四种真实结局
  （`applied` 立即生效 / `restart-required` / `overridden` 被更高优先级 patch 覆盖 / `failed` 附官方错误码）；
  不可启停的行给出官方同款原因（`management-required` / `unaddressable`）。
- **「插件市场」按钮**：打开**官方**插件页（市场 bundle 只往那一页注册一个 `discover` tab，没有可复用组件），
  降级顺序 `pluginNavigation.openList()` → `ctx.layout.selectPanel('plugins')`，都拿不到就不渲染按钮。
  不重建市场 UI，也不恢复社区 `dshmarket` 收编。
- **撤销上次变更**：官方 `failed` 结局其实**已经把配置写进文件**（`changed: true`），所以每次变更后页面留一个
  「撤销」，用同一个 `entryId` 反向调一次——「启用了一个会崩的插件」时这是唯一的退路。
- **隐藏侧栏自带的「插件」「更多」两行**（`register/sidebar-tweaks.ts`）：入口收敛到本面板。官方 `ctx.slots`
  没有隐藏能力、也不能反注册他人的槽条目，因此用 DOM 兜底（语义锚点 + fail-open + dispose 逐字恢复），
  属**已知易碎**方案，写入 README 的已知限制。

### Fixed

- **停用 `dsh-toolshed` 自己会被硬拒绝（409 `self-management`）**：官方保护集里没有本插件，真停掉会让面板
  当场消失且没有恢复入口，所以宿主侧直接拒绝，而不是把入口交出去。
- 线协议类型再导出的落点修正：`PluginRowView` 等四个类型误挂在 `../service/archive.types` 的再导出块上
  （`archive.types` 里没有这些名字，`tsc` 会报 TS2305；esbuild 擦除类型所以 `build` / `test` 发现不了），
  现单独从 `../service/plugins.types` 再导出。

## [2.0.2] — 2026-11-13

### Added

- **「会话」tab 显示会话名**（不再只有一串 id）：行首是投影缓存里的 `record.rows.title.val`（就是侧栏里那个标题），
  没有标题时退回首条输入的前缀，再没有就显示 id；**名字下面用小号等宽字体显示短 id**，同名会话也能区分。
  宿主侧 `GET /api/archived` 与 `POST /api/archive/plan` 都新增 `title` 字段（读 `storages/session_projcache/
  sessions/<id>.json`，不解压会话日志）。真机核对：15 条归档会话全部拿到名字（如「接入体重秤」
  「逆向米家获取体重秤数据」「数字个人工作台可行性分析」）。

## [2.0.1] — 2026-11-13

### Fixed

- **点「重启服务」总是报 `untrusted origin`（按钮等于不可用）**。1.x 在 `POST /api/host/restart` 上手写了一层
  「`Origin` 必须与 `Host` 同源、且拒绝任何 `forwarded` / `x-forwarded-for` / `x-real-ip`」的判据；而桌面壳的
  请求是经内部代理转发的，可能不带 `Origin`、或带上转发头，于是**每次点击都被 403**，弹窗里只剩一句看不懂的
  英文。现在删掉这层重复判据，信任边界完全交给 `defineRoutes` 的内建闸门（变更方法仅本机回环、
  `Origin` 与 `Host` 不符即 403、`connection.requestRejection` 做浏览器认证）——与 `DELETE /api/archive`
  等破坏性路由同一套；跨源请求仍被挡住（有回归测试覆盖）。
- 重启失败的反馈改成看得懂的话：被活跃工作挡住时用一句话概述原因；宿主明确拒绝时直接显示它的说明；
  其它错误附带 `code` / `HTTP 状态`，方便贴到 issue 里定位。

### Changed

- 脱离 fork 身份：项目主仓迁移为独立仓库 `z1lyA/dsh-toolshed`（`origin`），保留 `upstream`（functy23）用于
  cherry-pick 上游修复；改名前的 fork 已归档为 `z1lyA/dsh-toolshed-fork`（可删）。

## [2.0.0] — 2026-11-13

**更名，独立立项：`dsh-mcp-studio` → `dsh-toolshed`。**

从上游 `functy23/dsh-mcp-studio` fork 之后又并入了 `dsh-session-admin` 的会话管理与桌面重启，功能范围与身份
都已超出「MCP 工作室」，且 npm 上 `dsh-mcp-studio` 属上游作者、发不了同名包，因此改名独立发版。

### Changed

- 包名 / 插件 id / HTTP 路由前缀 / client bundle id 全改为 `dsh-toolshed`（路由前缀 `/dsh-toolshed/api/*`）；
  `cordis.patch.yml` 的行 id、`scripts/build.mjs` 的 `id`、`PLUGIN_ID` 同步。
- 侧边栏入口名从「扩展管理」改为「**工具管理**」（英文 `Toolshed`）——现在它管的是 MCP 行 / 技能 / 会话 / 重启。
- `LICENSE` 的版权行、`package.json` 的 repository / homepage / bugs 指向 `z1lyA/dsh-toolshed`；
  `THIRD_PARTY_NOTICES.md` 明确记录 fork 自 functy23/dsh-mcp-studio，上游 MIT + 附加条款继续适用。

### Notes

- **升级方式**：这是新 id 的新插件，需先卸载旧包再装新包（`dependencies` + `dsh.profile.bundles` 都要换名），
  不能原地覆盖；数据目录 `$DSH_HOME/session-admin/`（待删除队列、重启日志）**故意沿用**，队列意图不会丢。

## [1.2.0] — 2026-11-13

### Changed

- **取消「服务」页，重启收进标签页行最右侧**。面板只保留 技能 / MCP / 已归档 三个 tab；标签页那一行的右端常驻
  「刷新 + 重启服务」控件（`components/restart-control.tsx`）。**不能重启时按钮禁用**，原因直接写在 `title` 上
  （悬停即见：有运行中的会话 / 排队输入 / 后台任务，或当前不是桌面应用）；左侧刷新按钮重新拉
  `GET /api/host/restart` 重新判断。点击重启仍需一次确认弹窗（它会中断正在跑的回合），宿主恢复后页面自动重载。
- **移除插件市场收编**。删掉 `service/market.ts`、`components/market-tab.tsx` 与「撤下 dshmarket 设置页入口」的那段
  inject；面板不再有「市场」tab——市场是独立插件，装了它就用它自己的设置页入口。
- 「已归档」页的「待删除」提示不再跳转页面，改为提示右上角「重启服务」。
- 会话管理 tab 的名字从「已归档」改为「**会话**」（页面标题仍是「已归档会话」）；该页右上角的刷新从图标改成
  文字「刷新」，避免与面板右上角重启控件的刷新图标并排成两个旋转图标。
- 重启按钮的**原因提示改为一句话**（只列阻塞类型，不带 id），并且 `title` 同时挂在外层不会禁用的 `span` 上——
  禁用态的 `<button>` 在 Chromium 里收不到鼠标事件、`title` 常常不弹，这样悬停一定看得到原因。

### Removed

- `components/service-tab.tsx`、`components/service-tab.types.ts`、`components/market-tab.tsx`、
  `service/market.ts`、`service/market.types.ts`、`service/market.test.ts`，以及常量 `MARKET_SERVICE_NAME`。
- 已归档 / MCP 两页的 `onNavigate` 参数（没有「服务」页可跳了）。

## [1.1.0] — 2026-11-13

### Added

- **「已归档」tab —— 已归档会话管理**（移植自 [z1lyA/dsh-session-admin](https://github.com/z1lyA/dsh-session-admin)）。
  扩展面板变成五个标签页：市场（装了 dshmarket 时）/ 技能 / MCP / 已归档 / 服务。已归档页提供：
  全量列表（工作区、精确磁盘占用、文件数、子代理数）、全选-半选-单选、批量**取消归档**、
  批量**永久删除**（dry-run 计划 → 确认弹窗 → 执行）、**待删除**队列与「取消待删除」。
  删除的边界条件与 DSH 架构一一对应：只接受注册表里归档态的会话；仍在内存里活着的会话
  （含 subagent 派生子会话）不强删，只登记到 `$DSH_HOME/session-admin/pending-deletions.json`，
  下次 Host 启动时执行；整棵日志目录（绝不截断）、投影缓存、绑定会话的定时任务一起清掉；
  附件只在**完整**引用扫描证明无人引用后删除，扫描不完整时一个都不删。
- **「服务」tab —— 进程级重启**（同样来自 dsh-session-admin）。重启是宿主级动作：先检查工作区里
  运行中的回合、排队中的输入、running/stopping 的后台 job（**已归档会话豁免**），有交叉就拒绝并
  列出原因；无交叉时写重启计划、拉起脱离进程树的助手（`lib/restart-helper.js`）、HTTP 回复后
  `taskkill /T` 当前 Electron 进程树，助手等旧进程退出后用 GUI 方式重拉同一个可执行文件。
  日志在 `$DSH_HOME/session-admin/restart.log`。
- 新路由（`/dsh-mcp-studio/api/*`）：`GET /archived`、`POST /archive/plan`、`DELETE /archive`、
  `POST /archive/unarchive`、`POST /archive/pending/cancel`、`GET /host/restart`（与既有 POST 同路径，
  `defineRoutes` 按 `(kind, path)` 收敛，路由行数 13 → 18）。

### Changed

- **重启只剩一个入口，且换成了桌面可用的实现**。原实现的判据是 `DSH_DESKTOP === '1'` + 按 `dsh` CLI 语义
  重新 exec argv：桌面壳既没设那个环境变量、Host 进程的 argv 又是 `...\dsh-desktop-host\lib\index.js`
  （不匹配 `bin.js|dsh` 正则），实际会落到 `cmd /c dsh` 兜底分支，而且没有「有会话在跑就拦住」的安全闸；
  客户端那侧的 `window.dshDesktop.restartSidecar` 在本机 app.asar 里也查无此符号。
  现在统一走 session-admin 那套已在本机多次成功重启的实现（`restart.log` 可查），MCP 页只保留
  「配置已写入，需要重启」的提示与「去服务页」跳转。
- `host` 半新增第三个构建产物 `lib/restart-helper.js`（独立入口）：重启助手必须是磁盘上真实存在、
  且与主 bundle 分离的脚本，否则拉起它的 Host 被终止后它会一起消失。

### Fixed

- `/host/restart` 的 403 响应补上稳定的 `code: 'forbidden'`，与其余错误体形状一致。

## [1.0.6] — 2026-10-03

### Fixed

- **「新建技能」不再抢走当前对话**：1.0.3 起这一链路是「优先复用活跃会话」，于是点一次「新建技能」，
  草稿直接落进你正在写的那条对话（覆盖输入框里的内容），而不是开一条新的。现在按四级退级，顺序即语义：
  1. 官方 `sessions.create({ workspaceId })` —— 0.1.7 的「在当前目录新建对话」入口，在当前会话所属工作区
     开一条新会话并在 resolve 前发布进会话目录，返回值直接用于预填（核心 `dsh-client-ui-workspace` 的
     `reuseOrCreateBlank` 走的也是它）；
  2. 适配层从 `uiWorkspace` 投影回的 `workspaces.connectWorkspace` —— 上游写法（0.1.7 起导航从
     `workspaces` 搬到 `uiWorkspace`，适配层的 legacy 迁移已把它投影回原位，因此这条退级仍然可用）；
  3. 当前会话不属于任何工作区时（桌面壳的「未分组」），用它的 `cwd` 建会话——同样落在当前目录；
  4. 以上都拿不到才复用活跃会话，保证按钮仍有草稿可写。
  前几级抛错不再静默降级：错误照原样冒到面板的「无法启动技能创建器」提示上，避免同一个坑再被掩盖一次。
- **「/skill-creator」不是命令，是技能**：预填的 `/skill-creator ` 在输入框里不高亮、点不开、发送后也不加载任何东西。
  根因不是输入法也不是高亮逻辑——宿主只把技能目录里**真实存在**的条目认成 `/名字`（`@deepseek-ai/dsh-client-ui-skill`：
  「Ordinary-session candidates come from the `skills/list` Remote」），而上游 `dsh-tauri-panel-extension` 用
  `package.json` 的 `files: ["skills"]` 随包带了 `skill-creator`（anthropics/skills）与 `find-skills`
  （vercel-labs/skills），搬运时整个目录连同 `files` 项一起丢了：1.0.5 的包里既没有 `skills/`，`files` 也没有这一项，
  host 半的 `packagedSkillsDir()`（`<包根>/skills`）因此不存在，`provider.ts` 的 `existsSync` 过滤把它摘掉，
  技能目录里从来没有 `skill-creator`。
  现已按上游发布产物逐字节补回 `skills/skill-creator` 与 `skills/find-skills`（含各自的 LICENSE，见
  THIRD_PARTY_NOTICES.md），`files` 同步补 `skills`。

### Added

- `src/panel/client/register/extension-panel.utils.test.ts`：18 条用例覆盖会话/工作区快照投影与四级退级
  （含「有 `sessions.create` 时**不得**调用 `connectWorkspace`、不得复用活跃会话」这条回归断言）。

## [1.0.5] — 2026-10-01

### Fixed

- **插件市场 tab 在 Web / Desktop 上也出现**（[issue #1](https://github.com/functy23/dsh-mcp-studio/issues/1)）。
  上游 `hostsMarketPanel` 用 `window.parent !== window` 只收编 Tauri iframe，同一份代码搬过来后，
  浏览器 / DSH Desktop 里 `parent === window`，市场 tab 永远不出现，设置页入口也不会被撤下。
  本插件就是扩展面板宿主，判据改为只看 `dshmarket.render`：有就嵌进「市场」tab 并藏掉设置页重复入口；
  没装 `dshmarket` 或旧版（1.47.0，有 `market` 没有 `render`）不出现 tab，也不动设置页入口。

## [1.0.4] — 2026-09-29

### Fixed

- **文档更正：桌面版是可用的**。1.0.1 起 README 写「桌面版（`--profile desktop`）不可用，请勿安装」，
  依据是包清单里的 `dsh.client.platform: web` —— 那是把**客户端类型**（Web GUI）误读成了 profile 限制。
  实测：Web 与 Desktop 两个 profile 跑的客户端都是 `@deepseek-ai/dsh-web-app`，本插件在 desktop profile 上
  正常工作（面板、图标、技能创建均验证可用）。README 安装段改为 web / desktop 都给出命令，
  Platform 徽章回到 `Web | Desktop`。Tauri 版仍不在范围内（自带原生扩展面板插件）。

## [1.0.3] — 2026-09-27

### Fixed

- **新建技能报 `cannot get property "layout" without inject`**：客户端半漏声明 `layout` 服务。
  `definePanel` 的 `select()` / `close()` 会调 `ctx.layout.selectPanel()`，没进 `inject` 时 cordis 的反射代理直接抛错——
  技能其实已建好、草稿也填了，但以报错收场。`inject` 补为
  `['slots', 'locale', 'layout', 'sessions', 'workspaces']`。

## [1.0.2] — 2026-09-26

### Added

- **插件图标与显示名**（DSH 插件页此前显示的是默认风车占位图）：清单补 `icon: ./assets/icon.svg`，
  并新增 `locale/en.json` / `locale/zh.json` 的 `meta.title` / `meta.description`，卡片不再回退成包名。
  宿主约定：icon 必须是相对清单目录的路径、扩展名限 SVG/PNG/JPEG/WebP、上限 256 KiB、解析后不得越出包目录；
  `files` 白名单已加上图标与 locale，否则 npm 安装的用户拿不到。

### Changed

- 包描述与 README 的 Platform 徽章改为与 `dsh.client.platform: web` 一致的表述（此前写作「Web / Desktop / Tauri 通用」）。

## [1.0.1] — 2026-09-26

### Fixed

- **MCP 面板「全局」筛选永远空列表**：客户端按 `row.layer` 过滤，而服务端只发 `scope`（`layer` 从未被赋值），
  于是选「全局」看不到任何行、选「项目级」时全局行也混进来。删掉两处 `layer` 声明，筛选改读 `scope`。
- **`typecheck` 失效**：52 个报错（活代码 10 个 + vendor 37 个）。活代码部分修掉（`agents.ts` 的 unknown→string
  用类型守卫收窄；`restart/post.ts` 在 `strict: false` 下显式取联合分支），vendor 部分随不可达子树移出 `src`，现在全绿。
- **测试跑不起来 / 半数红**：新增 `vitest.config.ts`（旧裸包名别名，与 esbuild、tsconfig 同源）、补 `react-dom`
  开发依赖、恢复 `.test/test-utils.ts` 测试 helper 与 `HostRoute` 类型导出，使面板唯一的路由集成测试（13 条路由 +
  HTTP 行为）重新可用；删除 6 个被测物从未 vendor 的孤儿测试。测试从 29/50 文件可用变为 **16 文件 / 153 用例全绿**。
- **`dispose()` 不再同步释放资源**：hookable v5 的 `callHook` 改为异步，控制器契约与上游测试都要求同步，
  改为本地同步清理队列（vendor 内部相对路径 import，bridge 层够不着，故直接改本体）。

### Changed

- **线协议类型单一权威**：`src/panel/client/apis/index.type.ts` 改为从 host 的 `routes/index.types.ts` 再导出
  （原先是一份没有生成器的 OpenAPI 副本，两边已漂移出上面那个 `layer` 缺陷）。
- **`restartNeeded` 真正被消费**：MCP 行保存/启停/删除/导入后由响应决定是否显示重启条。只读的列表接口
  不再返回该字段（它恒为 `true`，客户端一消费就会让面板一进页面挂出常驻重启条）。
- **不可达 vendor 子树移出 `src`**：新增 `vendor-archive/`（135 个文件），不参与构建 / typecheck / 测试，
  只保留与上游的对照；`src/` 下即活代码。
- 删除无调用方的客户端 API 包装（`mcp/copy`、`roots` get/delete）与无消费方的 `addedAt` / `updatedAt` 字段；
  `restartHost` 返回类型收紧为 `Promise<void>`（它恒返 `{ ok: true }`，`error` 永不赋值）。

### Internal

- SKILL.md frontmatter 的写入与就地重写共用一套构造（原来两处各拼一遍、已开始分叉），并补 13 条契约测试。
- 新增 `scripts/run-tests.mjs`：给 rollup 原生绑定补 ad-hoc 签名 + 挑一个不带 hardened runtime 的 Node 跑 vitest。
- README 头部换成徽章版式并加项目图标（`assets/icon.svg` 为矢量源，`assets/icon.png` 供渲染）。
  本仓库**不加 CI**：typecheck 依赖宿主提供的 `@deepseek-ai/*`、测试依赖非 hardened 的 Node，
  干净 runner 上跑不出有意义结论，门禁一律放在本地。

## [1.0.0] — 2026-09-26

把 Tauri 桌面版的扩展面板整合成一个跨端插件。

### Added

- **原面板 UI 原样搬运**：`dsh-tauri-panel-extension` 的 MCP / Skills / 插件市场三个 tab、组件、样式、本地化、
  store 与全部 host 服务（mcp、skills、agents、repos、restart、rmtree、provider、storage）与路由（mcp、skill、import、roots、host）。
- **依赖整合**：`dsh-tauri` 与 `dsh-tauri-ui` 一并 vendor 进本包，构建期映射旧裸包名
  （`dsh-tauri` / `dsh-tauri/client` / `dsh-tauri-ui/client`），因此上游源码无需改动 import。
- **跨端支持**：插件不再依赖 Tauri 运行时；profile 探测补齐 `DSH_PROFILE` / `DSH_PROFILE_DIR` / 启动参数，
  Web 与 Desktop profile 都能正确读写自己的 `cordis.patch.yml`。
  > 更正（1.0.4）：1.0.1 这里曾写过「桌面版不可用」，那是把 `dsh.client.platform: web` 误读成了 profile 限制。
  > 实际 `web` 指**客户端类型**（Web GUI），Web 与 Desktop 两个 profile 跑的都是 `@deepseek-ai/dsh-web-app`，
  > 客户端半在 desktop profile 上正常工作（已实测：图标、面板、技能创建均可用）。
  > Tauri 版仍不在范围内——它有自己原生的扩展面板插件。
- **独立标识**：插件 id 与路由前缀改为 `dsh-mcp-studio`（`/dsh-mcp-studio/api/*`），可与 Tauri 版插件共存。


### Fixed

- **「新建技能」在 DSH Web / Desktop 上不可用**：新版核心已把导航能力从 `workspaces` 上移走
  （没有 `connectWorkspace` / `startSession`），上游「工作区 → 开新会话」链路必然报
  「没有可用工作区」。现在优先复用活跃会话（预填组件本就注册在每个会话输入框上），
  只有拿不到任何会话时才回退上游链路。
- **预填草稿不出现**：`SkillCreatorPrefill` 的依赖里加上 `pendingSessionIds` 订阅，
  复用已挂载的会话时 effect 也会重跑并写入草稿（上游靠新会话挂载触发，这条路径不存在了）。

### Notes

- 上游代码版权与“禁止商业性二次开发”附加条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 构建使用 esbuild、测试使用 **vitest**（见 `vitest.config.ts`）：DSH 运行时 Node 的 macOS 库验证会拒绝第三方
  `.node` 绑定（rollup / rolldown / vitest 均受影响），所以 `pnpm test` 走包装脚本 `scripts/run-tests.mjs`。