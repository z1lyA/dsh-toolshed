# AGENTS.md — dsh-toolshed

面向在本仓库工作的 agent / 开发者。

## 这个仓库是什么

把 Tauri 桌面版的扩展面板整合成一个跨端插件：

- `src/panel` ← `dsh-tauri-panel-extension`（面板本体：Skills / MCP / 插件市场 + host 服务与路由）
- `src/vendor/dsh-tauri` ← `dsh-tauri`（host 框架工具 + client 框架桥）
- `src/vendor/dsh-tauri-ui` ← `dsh-tauri-ui`（面板用到的组件与样式工具）
- `src/bridge` ← 构建期模块映射（旧裸包名 → 本地文件）
- `vendor-archive/` ← 从产物入口走不到的 vendor 子树（Tauri 专属 invoke/iframe 桥、上游 host 侧未搬运模块
  的测试等）。**不参与构建 / typecheck / 测试**，只作为「上游还有什么」的对照保留；`src/` 下即活代码。

**上游源码保持原样**：需要改行为时，优先在 bridge 或入口层适配，而不是改 vendor/panel 的语义。

例外只有一个：`src/vendor/dsh-tauri/client/controller/index.ts` 的 dispose 走了本地同步队列。原因是
hookable v5 的 `callHook` 变成异步（钩子要等一个微任务），而该控制器的契约是「dispose() 返回时资源已释放」，
上游测试也按同步断言；vendor 内部用相对路径 import（`../controller`），bridge 层替换够不着，只能改本体。

## 硬性约束

1. **不要重写 UI**。面板组件、样式、交互都来自上游；改动限于 import 解析、profile 探测、插件 id / 路由前缀。
2. **不要引入 Tauri 运行时依赖**。`window.__TAURI__`、`@tauri-apps/*`、iframe 父窗口消息桥都不得出现在产物里；
   Tauri 专属模块留在 vendor 但不被入口引用。可用 `grep -c '__TAURI__' lib/*.js` 自检（应为 0）。
3. **构建不要引入需要原生绑定的打包器**。DSH 运行时的 Node 开启 macOS 库验证，
   rollup / rolldown 的 `.node` 绑定会 `dlopen` 失败（实测），所以构建固定用 esbuild（独立二进制）。
   测试沿用上游的 vitest（`vitest.config.ts`，只收 `src/**/*.test.*`）：vite 会加载 rollup 的原生绑定，
   而它在两处踩同一个坑 —— 绑定本身没签名、DSH 自带 Node 又带 hardened runtime。`pnpm test` 因此不是裸
   `vitest run`，而是 `node scripts/run-tests.mjs`：先给绑定补一次 ad-hoc 签名（幂等，重装依赖后需重跑），
   再用一个**不带 hardened runtime** 的 Node（Homebrew 的 `/opt/homebrew/bin/node`）去跑 vitest，
   找不到可用 Node 时会打出可执行的下一步。别改测试框架，也别把 `.node` 塞进产物。
4. **官方包一律 external**。`@deepseek-ai/*`、`react`、`react/jsx-runtime` 由宿主提供；
   打进产物会导致 React 双实例与 hooks 失效。见 `scripts/build.mjs` 的 `officialExternal` 插件。
5. **直接改用户的 `cordis.patch.yml` 必须可回滚**：写入前备份，写入后回读校验，CRUD 自检要能保证文件与备份逐字节一致。
6. **技能启停沿用上游策略**（SKILL.md 的 `user-invocable` 策略位），不要新增旁路状态文件。

## 命令

```sh
pnpm install
pnpm typecheck     # tsc --noEmit（上游代码宽松，故 strict: false）
pnpm build         # node scripts/build.mjs
pnpm test          # node scripts/run-tests.mjs（签绑定 + 挑非 hardened Node，见约束 3）
node .test/host-smoke.mjs 25   # 不起 DSH：mock ctx 调 apply()，数 webServer.register 的行数（应为 25）
```

> **typecheck 需要宿主提供的 `@deepseek-ai/*` 类型**（约束 4 让它们保持 external）。作者机器上这些类型来自
> DSH 运行时；在没有它们的机器（例如只装了 Desktop 发行版）上 `pnpm typecheck` 会报一堆 `TS2307`——那是环境
> 缺口，不是代码坏了。此时代替门禁是 `pnpm build` + `pnpm test` + 真机硬刷新。别为了让 tsc 变绿去把官方包
> 装成 devDependency：它们的传递依赖里有未发布的包（`@deepseek-ai/dsh-user-interaction` 等），装不上。

**这个仓库没有 CI，是有意的**：`typecheck` 需要宿主提供的 `@deepseek-ai/*`（约束 4 让它们保持 external），
`test` 需要非 hardened 的 Node，两者在干净 runner 上都跑不出有意义的结论——把门禁放本地，
别加 workflow（加过一版，红了两次，已删）。

三个「别名同源」的地方改一处就要改全：`scripts/build.mjs` 的 esbuild alias、`tsconfig.json` 的 `paths`、
`vitest.config.ts` 的 `resolve.alias`（顺序敏感：具体键要排在 `dsh-tauri` 前面）。

DSH 自带的 Node 可能不在 PATH，手工跑 pnpm 时先加：

```sh
export PATH="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
```

## 本地安装与验证

```sh
# ~/.dsh/profiles/<profile>/package.json
#   dependencies: { "dsh-toolshed": "link:/abs/path" }
#   dsh.profile.bundles: [ ..., "dsh-toolshed" ]
pnpm install --dir ~/.dsh/profiles/<profile>
```

- host 半：`dsh.profile.bundles` 变更后 loader 会热挂载；**修改 lib/index.js 内容需要重启 DSH**。
- client 半：浏览器硬刷新（Cmd/Ctrl+Shift+R）。
- 路由自检：

```sh
curl -s http://127.0.0.1:<port>/dsh-toolshed/api/mcp
curl -s http://127.0.0.1:<port>/dsh-toolshed/api/skills
```

host 半可以在没有 DSH 的情况下冒烟测试：`node` 导入 `lib/index.js`，用带 `webServer` / `skills` / `connection` / `logger` / `on`
的 mock ctx 调 `apply(ctx, { profile: 'desktop' })`，应注册 **25** 条路由且不抛错（`.test/host-smoke.mjs` 就是它）。

## 约定

- **线协议类型只有一份权威**：`src/panel/host/routes/index.types.ts`；`src/panel/client/apis/index.type.ts`
  只做 `export type` 再导出（曾经是 OpenAPI 生成器副本，仓库里却没有生成器，两边漂移出过
  「客户端按 `layer` 过滤、服务端只发 `scope`」的静默 bug）。加字段只改 host 一处。
- **`strict: false` 下没有可辨识联合收窄**：`strictNullChecks` 关闭时 TS 不按 boolean 字面量判别式收窄
  （`if (outcome.owned)` 不生效），需要收窄时显式写 `as Extract<T, { owned: false }>`；lodash-es 也没有
  类型声明，`isString(x)` 不收窄 `unknown`，用本地类型守卫。
- 测试资产：`.test/test-utils.ts` 提供 `testDshHome` / `resetTestDshHome`（DSH_HOME 必须是模块加载期常量，
  `vi.mock` 工厂被提升后会捕获它的值，所以「每例一份干净环境」靠清空同一目录实现）。
  另外三个手工脚本（不进 vitest）：`.test/host-smoke.mjs`（注册路由数）、`.test/artifact-check.mjs`
  （产物自检）、`.test/live-data-probe.ts`（用真实 `~/.dsh` 只读跑 `list`/`plan`，需先用 esbuild 打成 mjs）。
  `vitest.config.ts` 里额外把 `@deepseek-ai/dsh-client-ui-primitives` 指到 `.test/primitives-stub.tsx`：
  官方 UI 包是 host-provided（构建期 external、本地未安装），否则组件渲染测试会 `Cannot find package`。
- 产物只有 `lib/index.js`（ESM host）、`lib/client.js`（ModuleLoader CJS client + id `dsh-toolshed`）与
  `lib/restart-helper.js`（**独立进程**的重启助手：拉起它的 Host 随后会被 taskkill，内联进主 bundle 就会一起消失，
  所以它是第三个 esbuild 入口，host 侧按固定文件名定位）。
- `package.json` 的 `dsh.client.inject` 必须列出用到的官方客户端模块（layout / primitives / renderer / locale）。
- **面板有四个 tab**（`client/components/extension-panel.tsx` 的 `rows`）：技能 / **插件** / 会话（会话 = 已归档会话管理）/
  MCP。标签页那一行的**最右侧**是重启控件（`restart-control.tsx`：只有「重启服务」一个动作）。
  新 tab 一律**追加在末尾**：`rows[0]` 就是首屏默认页，插到前面会改掉所有人的默认页。
  **唯一的例外是 2.2.0 的显式排序**（技能 / 插件 / 会话 / MCP）：那是用户点名要的顺序，不是「顺手调整」；
  再动顺序之前先确认这是不是又一个用户要求，别把默认页（`rows[0]` = 技能）一起挪了。
- **重启入口只有一个**：`restart-control.tsx`（标签页行最右）。**只有「不是桌面进程」和「正在重启」才禁用按钮**
  （2.6.0 去掉安全闸后：有会话在跑 / 排队输入 / 后台 job **不再拦**，只作为 `blockers` 如实提示）。
  禁用原因用一句话写在 `title` 上（悬停即见）；`title` 也要挂在外层那个**不会禁用**的
  `span.dshp-extension__tip` 上——Chromium 里禁用态 button 收不到鼠标事件、title 常不弹。
  刷新改成了**点「重启服务」时现读一次** `GET /api/host/restart`（2.6.1 删掉了独立的刷新按钮——
  安全闸没了之后它只影响提示文案的新鲜度）；读失败时**保留上一次结果**，别让一次网络抖动把按钮变灰。
  别再单开「服务」页，也别往别的页面塞第二个重启按钮。
  **别再把「活跃工作」接回成闸**：用户明确要求「我点重启就是真想重启」（2.6.0 之前的 409 `restart-blocked`
  已删除，`RestartStatusResponse` 也没有 `canRestart` 了）。`isDesktopHost` 那条判据**要留**——
  CLI / Web 形态下杀了自己没人重拉。
- **`restart.ts` 的 `executable` 必须在使用前声明**（`const`，TDZ）：曾经写在 `%` 检查之后，
  于是 Windows 上每次重启都在 `ReferenceError` 里 500（`tsc` 的 TS2448 早就报过，被当成噪声忽略了）。
  动这个文件时先跑一次真机重启。
- **插件市场收编已在 1.2.0 移除**（`service/market.ts`、`market-tab.tsx` 已删）：不要再把社区 `dshmarket`
  的面板嵌回来，也不要再动它的设置页入口——那是它自己的入口。
  2.1.0 的「插件市场」按钮走的是**官方** `@deepseek-ai/dsh-plugin-market`（它只往官方「插件」页注册一个
  `plugins.tab` = `discover`，没有可复用组件），行为是「打开官方插件页」：`ctx.get('pluginNavigation').openList()`
  → 降级 `ctx.layout.selectPanel('plugins')` → 都拿不到就不渲染按钮。**不要**为此重建市场 UI 或恢复 `dshmarket`。
  2.2.0 起再补一步「点到发现 tab」：官方 `pluginNavigation` **只有** `openList` / `openBundle`，
  两者都把页面强制切到 `installed`，所以只能打开页面后在 DOM 里找 `[id$="-<tabId>"]`（`SegmentedTabs` 的
  tab 按钮 id 是 `${tabsId}-<tabId>`）或 tablist 内文本等于槽条目 label 的按钮再 `click()`；
  命中不到就停在「已安装」——这是**兜底**，不是主路径（见 `register/extension-panel.utils.ts`）。
- **插件启停走官方 `pluginManager` 服务**（`service/plugins.ts`），**绝不**自己写 `cordis.patch.yml`：
  官方那层已经做了「保注释 / 保 `!!js` customTags / 原子写 + `withFileLock`」三件事（AGENTS 约束 5 的完整实现），
  而且启停失败**不抛异常**——回 `application: 'applied' | 'restart-required' | 'overridden' | 'failed'`，
  所以调用方必须判 `application`，只 `try/catch` 会把失败当成功。desktop profile 带 `hmr` 时 `applied` 是热生效、不重启。
  服务**不进 `apply.ts` 导出的 `inject`**：多一个名字会让缺该服务的组合（非 profile 启动 / 老 DSH）整块面板挂不上，
  一律惰性 `ctx.get('pluginManager')`，取不到就回 503 `plugin-manager-unavailable` 让页面降级。
  「停用 dsh-toolshed 自己」在服务层**硬拒绝**（409 `self-management`）：官方保护集里没有本插件，
  停掉面板当场消失、没有恢复入口。
- **「插件」tab 只讲第三方包**（2.9.0 定稿）：官方包**不在这里列**，也**不要**把「全部 / 第三方 / 官方」三档筛选加回来
  ——官方包的开关在服务层之外就被产品挡住了（`bundleToggleReasonOf` 对 `official` 一律返回「去官方页管理」），
  更新又被官方 `updateRefusal` 拒绝（`official` 显式排除），列出来只是一排点不动的卡片。
  官方插件（启停 / 卸载 / 换版本）走工具栏的**「官方插件页」**入口（`openOfficialPageOf`，落在官方页「已安装」）。
  **工具栏只留两个按钮**（2.9.1 用户定稿）：`检查更新` + `安装插件`；**别再加「刷新」**
  （进页面自动加载、任何操作后自动重拉），也**别把官方页入口塞回安装弹窗**（那是重复入口）。
  `openMarketLauncherOf`（点「发现」tab 那套 DOM 轮询）目前**没有接入**，保留但不要重新接回按钮；
  真要复活「逛市场」入口时先问用户。
- **「打开技能目录」跳的是 `~/.agents/skills`**（`AGENT_SKILLS_DIR`，2.9.1）：DSH 0.2.2 起原生扫这个目录，
  用户和 skill-creator 建的技能都在那儿；`~/.dsh/skills`（`SKILLS_DATA_DIR`）只是本插件自己的数据目录，
  「打开插件状态目录」（`plugin-state`）才用它。别把两者对调回来。
- **「插件」tab 只讲包（bundle），不讲 Loader 条目**（2.3.0 定稿）：`listPlugins()` 列的条目在本机有 227 条
  （`dsh-base` 一个包就 87 条、`dsh-web-app` 96 条），那是实现细节、不是「我装了什么」；条目级的精细开关
  留给官方「插件」页。所以 `GET /api/plugins` 只返回 `{ bundles }`，`PluginBundleView` **没有** `rows`，
  也没有 `/api/plugins/toggle` 这条行级路由——**别再把条目加回来**，用户明确说过「不要展示 loader 条目」。
  包级数据含 `official` / `meta.title` / `meta.description` / `meta.icon`（图标是 base64 data URL，
  超过 64 KiB 丢弃）；启停走 `setBundleEnabled(name, enabled)`（写 `dsh.profile.bundles`）。
  `LocalizedText` **不**在宿主端解析语言，原样透传给客户端用 `ctx.locale.resolveText()` 解析（官方页同做法）。
  `resolvePluginManager` 要求 `listBundles` / `setBundleEnabled` 两个方法都在，
  因此需要 DSH **0.2.2+** 才有插件管理（更老的宿主整 tab 回 503，页面如实降级）。
  **可见集要和官方页对齐**：官方那层过滤在页面侧（`PluginManagerPage` 的 `listed` + `dsh-official-bundles` 的
  `HIDDEN_BUNDLES`），服务端 `listBundles()` 给的是全量，所以宿主另有一份镜像名单 `NO_PAGE_BUNDLES`
  （`dsh-base` / `dsh-web-app` / `dsh-headless` / `dsh-sdk-app` / `dsh-acp-app` / `dsh-sdk-minimal` /
  持久终端 / worktree 工具）——它们在官方页里连卡片都没有，其中 `dsh-base` 一停就起不来。
  官方**新增**一个会让我们多显示一项（可接受），官方**改名**会让旧名字冒出来；「我们的列表里有官方页没有的包」
  时先来这里对一遍。
- **安装插件走官方 `inspect` + `installBundle`**（`service/plugins.ts` 的 `resolvePluginInstaller`），
  **绝不**自己跑 pnpm、不自己写 `package.json` / `pnpm-lock.yaml`：
  - `POST /api/plugins/inspect` 只识别（`invalid-spec` / `already-installed` / `not-found` / `not-a-package` /
    `not-a-bundle` / `network`），**不改任何文件**；`POST /api/plugins/install` 才真的装。
  - **构建脚本是两轮审批**：第一轮官方**什么都不装**，回 `pendingBuilds`；页面列给用户看，用户点「允许并继续」
    后带 `approvedBuilds` 再调一次。判「什么都没装」要**先看 `pendingBuilds` 非空**，
    别看 `errorCode`（官方那一轮是 `application:'failed'` + `error.code:'operation-error'`）。
  - `inspect` 的签名是 `inspect(spec, options?, signal?)`——将来要传 registry 得放进**第二个对象参数**，别当 signal。
  - 安装入口的判据是「先检查通过才能装」：`inspect` 不可用（503）时安装按钮不可点。
  - 安装结果除 `application` 外还带 `failureKind` 与 `output`（宿主截到尾部 8 KiB）：失败时那是唯一线索。
- **插件更新走官方 `listVersions` + `updateBundle`**（`service/plugins.ts` 的 `resolvePluginUpdater`，2.7.0）：
  - `POST /api/plugins/updates`（批量检查，body `{ names }`）**串行**逐个 `listVersions(name, {})`——官方客户端也是串行，
    一次点出 N 个 registry 请求既慢又容易被限流；单个包失败只记 `refused`，不中断整批。
  - 「更新到哪个版本」必须用官方口径挑：`bundle && !incompatible && !deprecated && !prerelease`（`updateCandidate`），
    别自己挑「最新」——预发布/弃用/不兼容 dsh 的版本装上去就起不来。
  - `POST /api/plugins/update`（`{ name, version, registry? }`）→ `updateBundle`。**更新是「先卸旧版再装新版」**：
    `restore` 出现表示新版失败后旧版已被装回，页面必须说出来，别让用户以为版本变了。
  - 只对 `BundleInfo.update === 'registry'` 的包查/更（`link:` 本地依赖没有这个字段，永远不可更新；
    `update === 'git'` 需要调用方给钉到 full commit 的 spec，面板不做，只提示去官方页）。
  - 客户端策略（2.7.0 定）：进 tab 自动批量查一次 + 10 分钟内存缓存；**检查全部完成后一次性**把有更新的置顶；
    **每次更新都要确认**（不做「查到就装」）。
- **卸载走官方 `removeBundle`**（`service/plugins.ts` 的 `resolvePluginRemover`，2.8.0）：官方语义是
  「已启用的先取消选中 → `pnpm remove` → reload」；「只在组合里、没有依赖」的可选包只是取消选中。
  拒绝码 `not-removable` / `stop-profile` / `bundle-in-use` 原样透出。**卸载入口只对 `removable: true` 的包渲染**
  ——随安装包提供的官方包永远是 false（点了只会拿到 `not-removable`）。`dsh-toolshed` 自己不显示入口、
  服务层也硬拒绝（409 `self-management`）。`inspect` 对「已安装的包名」一律回 `already-installed`，
  所以**升级已安装的包要走卸载/更新路径，不能靠安装弹窗**。
- **侧栏自带的「插件」行是 DOM 兜底隐藏的，「更多」只在安全时才藏**（`register/sidebar-tweaks.ts`），
  属**已知易碎**方案：官方 `ctx.slots` 没有 `when/hidden`、不能反注册他人条目，pins 还把 `plugins` 写死常驻，
  只有 DOM 一条路。定位只用语义锚点（`[data-slot="sidebar.panellist"]` 认 nav、运行时按槽条目 label 反查
  `aria-label` 认「插件」行、`aria-haspopup="menu"` 认「更多」），**不用**构建哈希类名（`wtg9ga_*`）、
  不用 nth-child、不写死中英文；全程 fail-open（命中 0 个什么都不做，最坏结果是「藏不掉」），
  `dispose` 逐字恢复原 inline 值。
  **「更多」绝不能无条件藏**（2.3.0 修过一次真实事故）：官方 `SidebarRoot` 的行过滤是
  `id === 'plugins' || !hasEntryActions || !unpinned.includes(id)`，被**取消固定**的入口只出现在「更多」菜单里，
  也只能在那儿重新固定，而固定状态是**内存态**（只有刷新才回来）。藏掉「更多」= 把入口关在门后。
  所以规则是「**渲染出来的行数 ≥ 已注册的 `main` 面板数**（= 一个都没被取消固定）才藏」，数不出来就不藏——
  fail-open 的方向必须选「多一行 More」而不是「入口找不回来」。改这段之前先读 `panel-pins.ts` 与
  `SidebarRoot.tsx` 的行过滤。
  官方改 `SidebarRoot` 结构（去掉 `aria-label` / 换掉 More 的交互 / 改 `data-slot` 锚点）就会静默失效——
  只对 0.2.x 成立，升级大版本要重验。
- **技能来源按「类别」展示，不按宿主原值**（`client/components/skills-tab.utils.ts` 的 `SOURCE_FAMILIES`）：
  DSH 的 `source` 有 `user-dsh` / `user-agents` / `project-dsh` / `project-agents` 四个值（`~/.dsh/skills` 与
  `~/.agents/skills` 及项目级同名目录），中文译名都只有「用户 / 项目」——按原值渲染筛选项就会冒出两个同名标签
  （2.6.2 修过一次）。统一合并成 项目 / 用户 / 运行时 / 内置 / 自定义 五类，认不出的来源归「自定义」，
  不要把机器值透到界面上，也别再按 `source` 原值新增筛选项。
- **技能根只挂「我们自己的」**（`service/provider.ts`）：随包自带的 `skills/` + 用户手动导入的根。
  **不要**再把 `~/.claude/skills` / `~/.codex/skills` 自动挂成 `customSkillDirs`（2.6.3 删除，`agents.peek()` 已不存在）：
  DSH 0.2.2 起原生扫 `~/.agents/skills`，而 `.claude/skills/<name>` 通常是 junction 指回它，再挂一遍就是
  同一批目录扫两次——DSH 按 rank 去重（`custom 300` < `user-agents 500`）会让 custom 那份**赢走标签**，
  于是整组技能被标成「自定义」。`service/agents.ts` 现在只负责 MCP 配置的导入扫描。
- **会话删除的定稿语义**（`service/archive.ts`，2.7.2）：**当场删文件，但不当场清归档墓碑**。
  - 非 live 会话：删日志目录 / 投影缓存 / 附件，磁盘立刻释放；
  - **不要**在删除时调 `unarchiveSession`（`remove` 传 `unarchiveOnDelete: false`）：墓碑一清，宿主内存里
    那条会话就会以「未分类」空壳冒到原生侧栏（用户实测过）。墓碑留着 = 仍算已归档 = 侧栏看不到；
  - `list()` 过滤掉「日志目录已不存在」的归档行（否则本页留一个点不开的「无日志」空壳）；
  - 下次启动的 `sweepPending` 跑 **孤儿墓碑清理**（`cleanOrphanTombstones`）：目录不存在且不在跑的归档 id
    统一 detach / unpin / unarchive，结果在 `sweep.results.orphans`；
  - live 会话仍然排队（当场删不掉），只有这种才显示「待删除」提示。
  - 2.7.1 曾经试过「全部排队」，用户否决（不要排队提示、不要重启才生效），别再改回去。
- 会话管理的服务层（`service/archive.ts`、`session-paths.ts`、`session-attachments.ts`、`pending-deletions.ts`）
  是**纯 Node**、不依赖 DSH 服务（靠 `ctx.get` 取），因此可以脱离 DSH 直接单测；它们的线协议类型在
  `service/archive.types.ts`，由 `routes/index.types.ts` 再导出给客户端。队列与重启日志的目录**保持**
  `$DSH_HOME/session-admin/`（改目录会让老队列的删除意图静默失效）。
- 中文注释解释“为什么”（约束、顺序、坑），不解释“是什么”。
- 任何行为变更都要同步 `README.md`、`README_EN.md`、`CHANGELOG.md`，并保留上游鸣谢与许可说明。
