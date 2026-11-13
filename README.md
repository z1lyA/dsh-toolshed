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

skills/                       ← 随包发布的技能（host 半按 package.json 的 files 一起带上）
  skill-creator/                「新建技能」预填的 /skill-creator 靠它成立，见下
  find-skills/                  与上游发布产物逐字节相同
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
5. **随包技能 `skills/`**：`/skill-creator` 是一条**技能**，不是内置命令——宿主只把技能目录里真实存在的条目
   认成 `/名字`。上游用 `files: ["skills"]` 打包了 anthropics/skills 的 `skill-creator` 与 vercel-labs/skills 的
   `find-skills`，本仓库按上游发布产物逐字节补回；缺了它，输入框里预填的 `/skill-creator` 就是普通文本：
   不高亮、点不开、发送后也不会加载任何技能。
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

装好后侧边栏出现 **工具管理**（Puzzle 图标），点开是三个 tab，标签页那一行的**最右侧**是刷新 + 重启服务：

| Tab | 能力 |
| --- | --- |
| **技能** | 技能列表（按来源分组）、搜索、启用 / 停用、查看与编辑 SKILL.md、新建技能（在当前工作区开一条新对话并预填 `/skill-creator`）、删除、打开目录、刷新 |
| **MCP** | 服务器列表（项目级 / 全局、启用状态、传输方式、URL / 命令）、新增与编辑表单、启用 / 停用、连接检查、复制片段、从其他 DSH profile 或 Claude / Cursor / Windsurf / VS Code 配置**导入扫描**、JSON 导出导入；写入后提示「需要重启」 |
| **会话** | 已归档会话列表（工作区、精确磁盘占用、文件数、子代理数）、全选 / 半选 / 单选、批量**取消归档**、批量**永久删除**（dry-run 计划 → 确认 → 执行）、**待删除**队列与取消 |
| **右上角重启控件** | 刷新（重新判断能否重启）+ 重启服务（进程级）。不可重启时按钮禁用，鼠标悬停即显示原因：有运行中的会话 / 排队输入 / 后台任务，或当前不是桌面应用 |

> 1.2.0 起**不再收编插件市场**：即使装了 `dshmarket`，也由它自己的设置页入口提供；本面板只保留技能 / MCP / 已归档。

技能启停沿用上游策略：写 SKILL.md 的 `user-invocable` 策略位，不新增旁路状态。

### 🗂 已归档会话管理

DSH 只提供归档 / 取消归档，**没有删除会话的接口**。这个 tab 把缺失的那一步补上，并把边界条件做成显式规则：

- 只有注册表里处于**归档态**的会话能被操作；id 走路径白名单（`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`）。
- **仍在内存里的会话不强删**：Host 只要打开过一条会话就持有 Agent 句柄，此时删日志会让后端重建无 header 的日志。
  这类会话（含它们的 subagent 派生子会话）被登记到 `$DSH_HOME/session-admin/pending-deletions.json`，
  **下次 DSH 启动时**在浏览器打开会话之前执行；页面显示「待删除」并支持随时取消。
- 删除范围：整棵会话日志目录 `sessions/<cwd 编码>/<sessionId 编码>/`（绝不截断 zstd 日志）、
  投影缓存 `storages/session_projcache/sessions/<id>.json`、绑定到该会话的定时任务、工作区槽位与归档墓碑。
- **附件（可选，默认开）**：先读被删会话事件得到候选 `sha256:` 对象，再扫描其余全部会话事件 +
  `$DSH_HOME/llm-deepseek/files-v3.json` 上传索引；只删除**没有任何剩余引用**的对象。
  扫描不完整（读失败 / 超预算）时**一个附件都不删**，并在结果里报告原因。
- 取消归档会立刻清掉该会话的待删除意图（监听 workspace 域的 `domain/changed`，页面每次读取也会兜底清理）。
- 已知限制：删除后本页会刷新，但原生侧栏的会话列表可能残留到下一次页面刷新 / 重启；
  多开实例时 JSON 存储域是「最后写入者获胜」，建议单实例操作。

### 🔄 右上角重启控件

重启是**进程级**实现（DSH 没有给插件暴露重启接口）：先检查工作区里运行中的回合、排队中的输入、
running / stopping 的后台 job（**已归档会话豁免**），有交叉就把按钮**禁用**并在 `title` 里列明原因
（悬停即见）；无交叉时点击 → 一次确认弹窗 → 写重启计划、拉起脱离进程树的助手
`lib/restart-helper.js`、HTTP 回复后 `taskkill /T` 当前 Electron 进程树，助手等旧进程退出、
单实例锁释放后以 GUI 方式重拉同一个可执行文件，页面在宿主恢复后自动重载。日志在
`$DSH_HOME/session-admin/restart.log`。

左侧的刷新按钮会重新拉一次 `GET /api/host/restart`：结束掉阻塞的会话/任务后点一下，按钮就恢复可用。
**只在 DSH 桌面应用里可用**（判据：`ELECTRON_RUN_AS_NODE=1` + argv 含 `dsh-desktop-host` + 有父进程）；
Web / CLI 会如实显示「不可用」。重启会中断当前回合，请先确认没有正在进行的对话。

<p align="center">
  <img src="assets/screenshot-skills.png" alt="扩展面板 · 技能" width="720" /><br/>
  <img src="assets/screenshot-mcp.png" alt="扩展面板 · MCP" width="720" />
</p>

## 🌐 HTTP API

面板的客户端半与脚本共用同源路由（沿用上游的安全闸门：变更方法要求本机回环来源、`Origin` 与 `Host` 不符直接 403）：

| 方法 | 路径 |
| --- | --- |
| GET | `/dsh-toolshed/api/skills`、`/api/mcp`、`/api/skill?name=`、`/api/roots`、`/api/import/scan`、`/api/archived`、`/api/host/restart` |
| POST | `/api/mcp`、`/api/mcp/toggle`、`/api/mcp/check`、`/api/mcp/copy`、`/api/skills/refresh`、`/api/skill`、`/api/skill/policy`、`/api/import/apply`、`/api/roots`、`/api/open/dir`、`/api/host/restart`、`/api/archive/plan`、`/api/archive/unarchive`、`/api/archive/pending/cancel` |
| DELETE | `/api/mcp`、`/api/skill`、`/api/roots`、`/api/archive` |

`defineRoutes` 按 `(kind, path)` 收敛，同一路径的多个方法只占一行 `webServer.register`：1.1.0 起共 **18** 行。
错误体统一是 `{ error, code }`（重启被挡住时多一个 `blockers` 数组），面板靠 `code` 分支。

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
| `fork-archive` | `z1lyA/dsh-toolshed-fork` | 改名/脱离前的 fork 备份，确认不再需要后可删 |

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
