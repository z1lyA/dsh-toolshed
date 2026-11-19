<div align="center">

<img src="assets/icon.png" alt="dsh-toolshed" width="128" />

# dsh-toolshed 工具棚

**DeepSeek Harness 的工具面管理插件：MCP 服务、Skills、已归档会话，外加宿主重启 —— 一个侧边栏入口搞定。**

[![dsh-toolshed](https://img.shields.io/badge/dsh--toolshed-DSH%20plugin-4d6bfe.svg)](https://github.com/z1lyA/dsh-toolshed)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-lightgrey.svg)](https://github.com/z1lyA/dsh-toolshed)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

[Issues](https://github.com/z1lyA/dsh-toolshed/issues) • [Changelog](CHANGELOG.md) • [English](README_EN.md) •
Fork 自 [functy23/dsh-mcp-studio](https://github.com/functy23/dsh-mcp-studio)

</div>

---

> **为什么改名**：早期它是上游 `dsh-mcp-studio` 的 fork（只做 MCP / Skills）；后来并入了
> [z1lyA/dsh-session-admin](https://github.com/z1lyA/dsh-session-admin) 的已归档会话管理与桌面进程级重启，
> 功能面与身份都变了，npm 上的 `dsh-mcp-studio` 又属原作者、发不了同名包，于是以 **`dsh-toolshed`** 独立立项
> （插件 id / 路由前缀 / 产物 id 全部换成新名，旧版需卸载后重装）。上游 MIT 与附加条款继续适用，见
> [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 📦 这是什么

Tauri 桌面版（[deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop)）的扩展面板功能原本分散在**三个互相依赖的插件**里：

| 上游包 | 作用 | 依赖 |
| --- | --- | --- |
| `dsh-tauri-panel-extension` | 扩展面板本体：**Skills / MCP / 插件市场** 三个 tab + host 路由 | `dsh-tauri`、`dsh-tauri-ui` |
| `dsh-tauri` | 宿主/客户端框架桥：`defineRoutes`、`defineService`、`definePanel`、`defineRegister`、locale、store | — |
| `dsh-tauri-ui` | 面板用的组件库：Button/Chip/Modal/SegmentedControl/PanelPage/图标… | `dsh-tauri` |

要装 MCP 管理，就得把这三个一起装上，而且只在 Tauri 发行版里可用。

**dsh-toolshed 把它们整合成一个包**：上游源码原样搬运（`src/panel`、`src/vendor/dsh-tauri`、`src/vendor/dsh-tauri-ui`），
用构建期模块映射（`src/bridge`）把旧的裸包名 `dsh-tauri` / `dsh-tauri/client` / `dsh-tauri-ui/client` 指到本地文件，
再补上通用化所需的最小改造 —— **界面本身一行 UI 都没重写**。

## ✨ 整合方式

```
src/                          ← 活代码：从产物入口走得到的部分
├── panel/                    ← dsh-tauri-panel-extension（原样搬运）+ 1.1.0 的会话管理
│   ├── host/                 service（mcp / skills / agents / repos / restart / rmtree
│   │                          / archive / pending-deletions / session-paths / session-attachments / restart-helper）、
│   │                         routes（mcp / skill / import / roots / archive / host）
│   ├── client/               components（mcp-tab / mcp-editor-form / mcp-import-dialog / skills-tab
│   │                          / archive-tab / restart-control / extension-panel）、
│   │                         register（extension-panel / skill-creator-prefill / styles）、locales、styles、store、apis
│   └── shared/
├── vendor/
│   ├── dsh-tauri/            ← dsh-tauri（host 框架工具 + client 框架桥；Tauri 专属的 invoke/iframe 桥保留但不进产物）
│   └── dsh-tauri-ui/         ← dsh-tauri-ui（面板用到的组件与样式工具）
└── bridge/                   构建期模块映射：旧裸包名 → 本地源码

vendor-archive/               ← 走不到产物入口的 vendor 子树（Tauri 专属桥、未搬运模块的测试）
                                不参与构建 / typecheck / 测试，只作上游对照
```

产物三个文件：`lib/index.js`（host 半，ESM）、`lib/client.js`（client 半，DSH ModuleLoader CJS）与
`lib/restart-helper.js`（重启助手，**独立进程**跑：拉起它的 Host 随后会被 taskkill，内联进主 bundle 就会一起消失）。

### 通用化改造（三处适配 + 行为修复）

1. **模块映射**：`dsh-tauri`、`dsh-tauri/client`、`dsh-tauri-ui/client` → `src/bridge/*`，因此上游源码**不需要改 import**。
2. **profile 探测**（`src/panel/host/service/profile.ts`）：上游只认 `--profile` 开关（Tauri 壳会传），
   嵌入 Web / Desktop 后必须补上 `DSH_PROFILE` / `DSH_PROFILE_DIR` / 启动参数里的 `<DSH_HOME>/profiles/<name>`，
   否则 MCP 行会写错 profile。
3. **独立标识**：插件 id 与路由前缀为 `dsh-toolshed`（`/dsh-toolshed/api/*`），与 Tauri 版插件、以及上游
   `dsh-mcp-studio` 都不同，可共存互不覆盖。
   可与 Tauri 版共存、互不覆盖。

此外还有面板行为修复（依赖新版核心的导航能力变化，见 [CHANGELOG.md](CHANGELOG.md)）：

4. **「新建技能」开新对话**：上游只走「工作区 → `connectWorkspace` 开新会话」，而 0.1.7 起导航搬到了 `uiWorkspace`。
   现在按四级退级：官方 `sessions.create({ workspaceId })` 在**当前会话所属工作区**新建一条对话 → 适配层投影回的
   `workspaces.connectWorkspace` → 会话不属于任何工作区时按它的 `cwd` 建 → 实在无处可建才复用活跃会话。
   点一次「新建技能」不再抢走你正在写的那条对话。
5. **不再随包带技能（2.6.4）**：`/skill-creator` 是一条**技能**，不是内置命令——宿主只把技能目录里真实存在的
   条目认成 `/名字`。上游用 `files: ["skills"]` 打包了 anthropics/skills 的 `skill-creator` 与 vercel-labs/skills 的
   `find-skills`，本仓库 2.0.x–2.6.3 也逐字节补回；2.6.4 起两个目录都移除（`find-skills` 与
   `~/.agents/skills/find-skills` 内容相同，`skill-creator` 改由用户放进 `~/.agents/skills`）。
   **后果**：技能没装时，预填的 `/skill-creator` 只是普通文本（不高亮、点不开、发送后也不加载技能）——
   所以技能页会检测它是否在列，不在就把「新建技能」按钮禁用并在悬停提示里说明怎么装。
6. **插件市场收编已移除（1.2.0）**：上游用 iframe（`window.parent !== window`）才收编 `dshmarket`，那是给 Tauri 壳用的；
   1.0.5 起本插件改成「只要 `dshmarket` 发布 `render` 就嵌进市场 tab」，1.2.0 起**整段移除**——
   市场是独立插件、低频，占用面板标签页不划算；装了 `dshmarket` 就继续用它的设置页入口。

Tauri 专属部分（`dsh-tauri/client` 的 invoke / listen / iframe 消息桥、桌面侧边栏注入）**保留在 vendor 里但不被引用**，
所以产物不会访问 `window.__TAURI__`，在 Web 与 Desktop 上同样工作。

## 🚀 安装

装到你想用的那个 profile 上：

```sh
dsh plugin --profile web     add dsh-toolshed@latest   # DSH Web 版（尚未发 npm 时用下面的 link 方式）
dsh plugin --profile desktop add dsh-toolshed@latest   # DSH 桌面版
```

包内声明了 `dsh.bundle.patch`，安装即自动挂载；host 半更新后重启一次 DSH，然后硬刷新浏览器（Cmd/Ctrl+Shift+R）。

> **关于 `dsh.client.platform: web`**：这里的 `web` 指**客户端类型**（Web GUI），不是 profile 名字。
> Web 与 Desktop 两个 profile 跑的都是 `@deepseek-ai/dsh-web-app`，同一个客户端，所以两端都能用；
> 本插件的客户端半依赖它的官方模块（ui-layout / ui-primitives / ui-renderer / locale）。
>
> **Tauri 版不在范围内**：Tauri 发行版有自己的原生扩展面板插件。本仓库只是把那三个包搬过来整合成
> 跨端插件，产物里没有任何 Tauri 运行时依赖，也不反过来替换 Tauri 版的原生插件。

> **不要与 `dsh-session-admin` 同时安装**：1.1.0 已包含它的全部能力（已归档删除、待删除队列、进程级重启）。
> 两个插件会同时读改写同一个 `$DSH_HOME/session-admin/pending-deletions.json`，并重复注册 `workspace` 域的
> `domain/changed` 监听。升级步骤：先把本包装成 `link:` 并确认新 tab 正常，再卸载旧插件
> （`plugin_manager({ action: "remove_bundle", target: "dsh-session-admin" })`；若报 `bundle-in-use`，
> 先从 profile 的 `dsh.profile.bundles` 去掉它、再删 `dependencies` 里的 `link:` 项，最后
> `pnpm install --offline --dir <profile>` 收敛 lockfile）。

本地开发（link）：

```sh
pnpm install && pnpm build
# ~/.dsh/profiles/<profile>/package.json
#   "dependencies": { "dsh-toolshed": "link:/abs/path/to/dsh-toolshed" }
#   "dsh": { "profile": { "bundles": [ ..., "dsh-toolshed" ] } }
pnpm install --dir ~/.dsh/profiles/<profile>
```

## 🧭 界面

装好后侧边栏出现 **工具管理**（Puzzle 图标），点开是四个 tab（顺序：技能 / 插件 / 会话 / MCP），
标签页那一行的**最右侧**是刷新 + 重启服务：

| Tab | 能力 |
| --- | --- |
| **技能** | 技能列表、**按来源类别筛选**（项目 / 用户 / 运行时 / 内置）、搜索、启用 / 停用、查看与编辑 SKILL.md、新建技能（在当前工作区开一条新对话并预填 `/skill-creator`）、删除、打开目录、刷新。来源按类别合并展示：`~/.dsh/skills` 与 `~/.agents/skills` 都算「用户」 |
| **插件** | **只按包（npm bundle）**列出当前 profile 的插件：图标 + 名称 + 一句话简介 + 版本 + 启停状态；`全部 / 第三方 / 官方` 三档筛选（默认第三方）、搜索（包名 / 标题 / 简介）、**包级启用 / 停用**、**检查更新与一键更新**（进页面自动查一次、10 分钟缓存、有更新的置顶并标 `可更新 x → y`，点「更新到 x.y.z」逐个确认后执行）、失败后**撤销上次变更**；右上角「插件市场」直接跳到官方插件页的**发现** tab。**不展示 Loader 条目**——条目级的精细开关在官方插件页 |
| **会话** | 已归档会话**按工作区分组**（组默认折叠，点开才见该工作区的会话；无工作区的归「未关联工作区」并置底）；组头 = 工作区名 + 会话数 + 该组占用 + 待删除数；**全局全选跨所有组（含折叠的）**，每组另有组内全选 / 半选。会话行仍显示**会话名 + 短 id**、精确磁盘占用、文件数、子代理数；批量**取消归档**、批量**删除**（dry-run 计划 → 确认 → 登记排队，**下次启动 DSH 时执行**，想立刻执行点右上角「重启服务」；排队项立刻从列表消失，可随时取消）、**待删除**队列与取消 |
| **MCP** | 服务器列表（项目级 / 全局、启用状态、传输方式、URL / 命令）、新增与编辑表单、启用 / 停用、连接检查、复制片段、从其他 DSH profile 或 Claude / Cursor / Windsurf / VS Code 配置**导入扫描**、JSON 导出导入；写入后提示「需要重启」 |
| **右上角重启控件** | 只有一个「重启服务」（进程级）。**不因为有会话在跑而禁用**：只有「不是桌面应用」或「正在重启」才禁用；点它时现读一次活跃工作，`title` 与确认弹窗会列出重启会中断什么（运行中的会话 / 排队输入 / 后台任务各几个） |

> 1.2.0 起**不再收编社区市场 `dshmarket`**；2.1.0 起的「插件市场」入口打开的是**官方插件页**
> （`@deepseek-ai/dsh-plugin-market` / `dsh-client-ui-plugin-market` 只往那一页注册一个 `discover` tab，
> 没有可复用的组件，所以本面板不重建它）。2.2.0 起该按钮还会**自动切到那一页的「发现」tab**。

技能启停沿用上游策略：写 SKILL.md 的 `user-invocable` 策略位，不新增旁路状态。

### 🔌 插件与市场入口

#### 为什么「几百个插件」里你只装了个位数

官方 `listPlugins()` 列的是 **Loader 条目**，不是包：DSH 把自己切成了两百多个 cordis 插件条目
（本机实测 227 条，其中 `dsh-base` 一个包就声明了 87 条、`dsh-web-app` 96 条），而**你自己装的只有 6 个包**。

所以这个 tab **只讲包**（`listBundles()`）：一张卡片一个 npm 包，**不列 Loader 条目**；
默认筛选就是**第三方**（`official === false`），打开就只剩你装的那几个。
（条目级的精细开关——比如单独关掉某个内部模块——属于官方「插件」页，那里能看到包内每一行。）

- 包的数据来自官方 `pluginManager.listBundles()`：`official`（官方维护 / 市场目录）、`installed`、`enabled`、
  `version`、`availability`，以及**本地化展示元数据** `meta.title` / `meta.description` / `meta.icon`
  （图标是包自带的 base64 data URL，超过 64 KiB 的不透传）。文案由运行时语言解析（`ctx.locale.resolveText`），
  本插件不猜语言。
- **包级启停**走 `setBundleEnabled(name, enabled)`（写 profile 的 `dsh.profile.bundles`，也就是组合里加/减这一层），
  由官方服务负责落地：保留注释与 `!!js` 表达式、原子写、文件锁——本插件不自己写 YAML。
- 结果原样透出四种结局：`applied`（带 hmr 的 profile 立即生效）/ `restart-required`（需要重启）/
  `overridden`（被更高优先级的 patch 覆盖）/ `failed`（附官方错误码与诊断）。
  **`failed` 时配置文件其实已经写了**，所以页面会保留一条「撤销上次变更」。
- 不可启停的包会说明原因：`management-required`（插件管理本身所需）或 `unaddressable`
  （当前 profile 的 patch 无法唯一定位这一项），与官方页面同一套文案。
  **官方包的包级开关在本面板禁用**（那属于官方页的卸载 / 目录职责），第三方包才是这里的操作对象。
- **不能在这里停用 `dsh-toolshed` 自己**：官方保护集里没有它，停掉面板会当场消失且没有恢复入口，
  服务层直接回 409 `self-management`。
- 当前部署没有 `pluginManager` 服务（没有 profile，或 DSH < 0.2.2）时如实回 503
  `plugin-manager-unavailable`，页面显示「当前部署没有插件管理服务」，而不是装作空清单。
- **可见集和官方插件页一致**：官方页会隐藏一批「没有插件页」的包——别的 profile 模板用的基础组合
  （`dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-sdk-app`、`dsh-sdk-minimal`、`dsh-acp-app`）、
  持久终端 bundle、worktree 工具。这些在官方页里连卡片都没有，本页同样不列出
  （所以你不会看到 `dsh-sdk-app` / `dsh-sdk-minimal`，它们不是「前置插件」，是 sdk/sdk-minimal 那两种
  profile 模板要用的基础组合；`dsh-base` 更是一停就起不来）。名单是官方 `HIDDEN_BUNDLES` 的镜像，
  官方新增/改名时以官方页为准。

「插件市场」按钮打开的是一个**「安装插件」弹窗**（不是复刻官方「发现」页）：

- 输入 `包名` / `name@1.2.3` / `git+https://…` / 本地路径 / tarball URL → 「检查」→ 显示识别结果
  （包名、版本、一句话简介、是不是 DSH 插件包；git / tarball 这种形式要装完才确认得了）。
- 「安装」走官方 `pluginManager.installBundle()`（**本站不自己跑 pnpm、不自己写 `package.json`**）。
  安装要执行**构建脚本**时官方不会装，而是回一份 `pendingBuilds`：弹窗列出这些包名，点「允许并继续」
  才带 `approvedBuilds` 再调一次。
- 结果如实显示 `applied` / `restart-required`（需要重启 DSH）或失败种类（网络、包不存在、pnpm 缺失、
  脚本未批准……）加 pnpm 输出尾部，方便直接贴进 issue。
- 想看**市场目录**（我设的索引、搜索、详情页、版本列表）仍在官方页：弹窗底部按钮会打开官方插件页的「发现」tab。

> 为什么不把官方「发现」页搬进来：市场客户端只导出 `apply`（把它的 `DiscoverSection` 注册到官方页的
> `plugins.tab`），既没有组件也没有 `render()`；复刻一遍会跟着市场索引与详情文档的格式一起漂移。
> 而「输入包名直接装」这件事**根本不需要市场索引**——它只是官方 `installBundle` 的一层壳。

#### 更新

- **进入「插件」页时自动查一次**（只查 `update === 'registry'` 的包，串行、不阻塞列表渲染），
  结果缓存 10 分钟；顶部有「检查更新」可手动重查（手动重查失败会把原因说出来，自动查失败保持静默）。
- **检查全部完成后一次性重排**：有可用更新的包置顶，其余保持「第三方 → 官方 → 包名」的顺序。
- 有更新的卡片显示 `可更新 0.6.4 → 0.6.5` 徽标和「更新到 0.6.5」按钮；**每次更新都要确认**
  （弹窗里给当前版本 → 目标版本 + 来源 registry），执行中显示进度，结束显示结果。
- 版本候选按官方口径挑：`bundle` 为真、兼容当前 dsh、**不是弃用版、不是预发布版**——不会把装上去就起不来的版本推给你。
- **更新是「先卸旧版再装新版」**：新版装失败时官方会把旧版装回去，页面会明说「已回滚到 x.y.z」，别以为版本变了。
- `link:` 本地依赖（比如 `dsh-toolshed` 自己）**没有** `update` 字段，永远不显示更新入口；
  `update === 'git'` 的包需要钉到 full commit 的 spec，面板不自动查，只提示去官方插件页。

> 为什么不点卡片跳官方详情页：官方 `pluginNavigation.openBundle()` 会**切换主面板**——工具管理页被卸载、
> 页内筛选与搜索丢失，回来后还会落在首屏「技能」tab；而详情页自己的「返回」只回到官方「已安装」列表。
> 所以更新做在页内，详情/卸载/指定版本仍走「插件市场」按钮（那是明确的"去官方页"语义）。

> **已知限制（易碎）**：为了把入口收敛到本面板，`register/sidebar-tweaks.ts` 会隐藏侧栏自带的
> 「插件」行（官方把它写死常驻，不会丢），并**在安全时**隐藏「更多」。官方 `ctx.slots` 没有「隐藏/条件注册」
> 能力、也不能反注册他人的槽条目，所以这是 **DOM 兜底**：只用语义锚点（`data-slot="sidebar.panellist"`、
> 按槽条目 label 反查的 `aria-label`、`aria-haspopup="menu"`），不用构建哈希类名与 nth-child，且全程 fail-open。
> 官方改侧栏结构后可能**藏不掉**（不会报错、也不会误伤本面板那一行）。
>
> **「更多」为什么不能无条件藏**：官方侧栏的行过滤是「固定 + 未被取消固定的」，被**取消固定**的入口只出现在
> 「更多」菜单里、也只能在那儿重新固定，而固定状态是**内存态**（刷新才恢复）。藏掉「更多」等于把入口关在门后。
> 所以本插件只在「渲染出来的行数 ≥ 已注册的面板数」（= 一个都没被取消固定）时才藏它；一旦你取消了某个入口的
> 固定，「更多」会立刻自己回来给你当回收口。想彻底恢复原样，删掉 `client/index.ts` 里那行
> `ctx.effect(sidebarTweaksFeature, …)` 即可。

### 🗂 已归档会话管理

列表**先按工作区分组**：组头一行（工作区名 + 会话数 + 该组磁盘占用 + 待删除数），点开才展开该工作区的会话行；
没有工作区信息的会话归到「未关联工作区」并压在最底部。**勾选不受折叠影响**：右上角全选是跨全部工作区的，
每组还有一个自己的组内全选（半选状态也按该组算），组头的「已选/总数」随勾选实时变。
组顺序按工作区名排（固定用 `zh-Hans-CN` 排序，免得同一个列表在两台机器上顺序不同）；**组内保持宿主给的顺序**。

DSH 只提供归档 / 取消归档，**没有删除会话的接口**。这个 tab 把缺失的那一步补上，并把边界条件做成显式规则：

- 只有注册表里处于**归档态**的会话能被操作；id 走路径白名单（`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`）。
- **删除一律排队，下次启动 DSH 时执行**（2.7.1 起）：点删除只是把会话登记到
  `$DSH_HOME/session-admin/pending-deletions.json`，**不会当场删文件**。
  为什么：当场删要顺手清归档墓碑（`unarchiveSession`），而宿主内存里还记得这些会话——墓碑一清，
  原生侧栏就会把它们当成「没有工作区的普通会话」显示成**「未分类」空壳**（用户实测过）。
  把「真正删除」与「墓碑/槽位清理」都推到启动时，那时注册表从磁盘重建，两个页面都不会出现中间态。
  - 排队项**立即从本页列表里消失**，只留一行「N 条已排队 · 取消」；
  - 想立刻执行就点右上角**「重启服务」**（那条路本来就有）；
  - 代价：磁盘**要等到下次启动/重启才释放**（这是有意的取舍）。
- 删除范围：整棵会话日志目录 `sessions/<cwd 编码>/<sessionId 编码>/`（绝不截断 zstd 日志）、
  投影缓存 `storages/session_projcache/sessions/<id>.json`、绑定到该会话的定时任务、工作区槽位与归档墓碑
  ——都在**启动时的 sweep** 里做，同样一条一条重新校验（会话又变活了就留在队列里）。
- **附件（可选，默认开）**：先读被删会话事件得到候选 `sha256:` 对象，再扫描其余全部会话事件 +
  `$DSH_HOME/llm-deepseek/files-v3.json` 上传索引；只删除**没有任何剩余引用**的对象。
  扫描不完整（读失败 / 超预算）时**一个附件都不删**，并在结果里报告原因。
- 取消归档会立刻清掉该会话的待删除意图（监听 workspace 域的 `domain/changed`，页面每次读取也会兜底清理）。
- 已知限制：删除后本页立即干净（排队项不再列出），原生侧栏本来也不会显示归档会话——2.7.1 之前的
  「未分类」残留正是当场删 + 清墓碑造成的，现在不会出现；多开实例时 JSON 存储域是「最后写入者获胜」，建议单实例操作。

### 🔄 右上角重启控件

重启是**进程级**实现（DSH 没有给插件暴露重启接口）：点击 → 一次确认弹窗 → 写重启计划、拉起脱离进程树的助手
`lib/restart-helper.js`、HTTP 回复后 `taskkill /T` 当前 Electron 进程树，助手等旧进程退出、
单实例锁释放后以 GUI 方式重拉同一个可执行文件，页面在宿主恢复后自动重载。日志在
`$DSH_HOME/session-admin/restart.log`。

**没有「安全闸」**（2.6.0 起）：不会因为「有会话在跑 / 有排队输入 / 有后台任务」而禁用或拒绝。
这些仍然会被读出来（运行中的回合、排队中的输入、running / stopping 的后台 job，**已归档会话豁免**），
只用于**如实告诉你重启会中断什么**——按钮的 `title` 与确认弹窗里会列成「运行中的会话 ×2、后台任务 ×1」。
点确认就执行：点之前你已经确认过没有要继续的东西了。

点「重启服务」时**现读一次** `GET /api/host/restart`——确认弹窗打开时看到的就是当下的实情。
（2.6.1 删掉了那个独立的刷新按钮：安全闸没了之后它只影响一句提示文案的新鲜度，没有存在的必要。）
**只在 DSH 桌面应用里可用**（判据：`ELECTRON_RUN_AS_NODE=1` + argv 含 `dsh-desktop-host` + 有父进程）；
Web / CLI 会如实显示「不可用」——那种形态下杀了自己没人重拉，所以这条判据保留。

<p align="center">
  <img src="assets/screenshot-skills.png" alt="扩展面板 · 技能" width="720" /><br/>
  <img src="assets/screenshot-mcp.png" alt="扩展面板 · MCP" width="720" />
</p>

## 🌐 HTTP API

面板的客户端半与脚本共用同源路由（沿用上游的安全闸门：变更方法要求本机回环来源、`Origin` 与 `Host` 不符直接 403）：

| 方法 | 路径 |
| --- | --- |
| GET | `/dsh-toolshed/api/skills`、`/api/mcp`、`/api/skill?name=`、`/api/roots`、`/api/import/scan`、`/api/archived`、`/api/plugins`、`/api/host/restart` |
| POST | `/api/mcp`、`/api/mcp/toggle`、`/api/mcp/check`、`/api/mcp/copy`、`/api/skills/refresh`、`/api/skill`、`/api/skill/policy`、`/api/import/apply`、`/api/roots`、`/api/open/dir`、`/api/plugins/bundle/toggle`、`/api/plugins/inspect`、`/api/plugins/install`、`/api/plugins/updates`、`/api/plugins/update`、`/api/host/restart`、`/api/archive/plan`、`/api/archive/unarchive`、`/api/archive/pending/cancel` |
| DELETE | `/api/mcp`、`/api/skill`、`/api/roots`、`/api/archive` |

`defineRoutes` 按 `(kind, path)` 收敛，同一路径的多个方法只占一行 `webServer.register`：2.7.0 起共 **24** 行。
错误体统一是 `{ error, code }`（重启被挡住时多一个 `blockers` 数组），面板靠 `code` 分支。
`/api/plugins` 在缺少官方 `pluginManager` 服务时回 503 `plugin-manager-unavailable`；
`/api/plugins/bundle/toggle` 在「停用 dsh-toolshed 自己」时回 409 `self-management`，
正常请求一律 200（`application: 'failed'` 也是 200 —— 那是业务结局，不是传输错误）。
`GET /api/plugins` 只返回 `{ bundles }`：插件页以包为单位，Loader 条目不再出现在线协议里
（2.3.0 删掉了行级路由 `/api/plugins/toggle`）。
`/api/plugins/inspect` 只做识别（不改任何文件），`/api/plugins/install` 才会真的跑 pnpm；
后者把官方 `ChangeResult` 里与装包有关的部分投影出来（含 `pendingBuilds` 与 pnpm 输出尾部）。
`/api/plugins/updates` 批量检查（串行问 registry，单个失败只记 `refused` 不中断），`/api/plugins/update`
执行更新并把官方的 `PluginUpdateResult` 投影出来——`restore` 字段出现即表示「新版失败、旧版已装回」。

## 🛠 开发

```sh
pnpm install
pnpm typecheck     # tsc --noEmit，解析宿主真实类型（当前全绿）
pnpm build         # node scripts/build.mjs → lib/index.js + lib/client.js + lib/restart-helper.js
pnpm test          # node scripts/run-tests.mjs（vitest；见下方说明）
```

**远程仓库（本项目已脱离 fork 身份，是独立仓库）**：

| remote | 指向 | 用途 |
| --- | --- | --- |
| `origin` | `z1lyA/dsh-toolshed` | 本项目主仓（独立，非 fork） |
| `upstream` | `functy23/dsh-mcp-studio` | 只读参考：上游框架层的修复可以 `git cherry-pick` 过来 |
| `fork-archive` | `z1lyA/dsh-toolshed-fork` | 脱离 fork 前的备份，**已归档（只读）**；确认不需要后可在 GitHub 上删除（删除需要 `delete_repo` 权限：`gh auth refresh -s delete_repo` 或网页 Settings → Danger Zone） |

> 本仓库**没有 CI**：验证依赖 DSH 宿主与 macOS 签名，跑在干净 runner 上只能验一半，
> 所以 `typecheck` / `test` / `build` 一律以本地为准。

> `pnpm test` 不是裸 `vitest run`：vite 加载的 rollup 原生绑定既没签名，DSH 自带 Node 又带
> hardened runtime，两处都会让 `dlopen` 失败。包装脚本 `scripts/run-tests.mjs` 会先补一次 ad-hoc 签名，
> 再挑一个不带 hardened runtime 的 Node 跑 vitest（找不到会给出下一步）。
>
> 旧裸包名的映射共三处，改一处要三处同改：`scripts/build.mjs`（esbuild alias）、`tsconfig.json`（paths）、
> `vitest.config.ts`（resolve.alias）。

> 构建用 **esbuild**：DSH 运行时的 Node 开启了 macOS 库验证（library validation），
> rollup/rolldown 的 `.node` 绑定因 Team ID 不同会 `dlopen` 失败。详见 [AGENTS.md](AGENTS.md)。

## 🙏 鸣谢

- **[deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop)**（Tauri 桌面版，作者 Hairyf 与贡献者）——
  本项目搬运的 `dsh-tauri-panel-extension`、`dsh-tauri`、`dsh-tauri-ui` 三个包全部来自该仓库，
  **界面、交互与 host 服务逻辑均为其原始实现**；没有它就没有这个插件。请优先支持上游与 Tauri 桌面版。
- **[z1lyA/dsh-session-admin](https://github.com/z1lyA/dsh-session-admin)** —— 「已归档」tab 与面板右上角的进程级重启
  移植自该插件（含删除边界规则、待删除队列与桌面进程级重启）；原始 MIT 许可与改动说明见
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 官方插件开发文档：<https://deepseek-harness.github.io/deepseek-harness/develop/basic/>

## 📄 License

MIT（见 [LICENSE](LICENSE)）。搬运的上游代码同样以 MIT 发布，并附带
[Additional Terms — No Commercial Secondary Development](THIRD_PARTY_NOTICES.md)：
**不得用于商业性二次开发**，本项目亦以非商业开源形式分发。
