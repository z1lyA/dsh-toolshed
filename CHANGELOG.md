# Changelog

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