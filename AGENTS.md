# AGENTS.md — dsh-mcp-studio

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
node .test/host-smoke.mjs 18   # 不起 DSH：mock ctx 调 apply()，数 webServer.register 的行数（应为 18）
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
#   dependencies: { "dsh-mcp-studio": "link:/abs/path" }
#   dsh.profile.bundles: [ ..., "dsh-mcp-studio" ]
pnpm install --dir ~/.dsh/profiles/<profile>
```

- host 半：`dsh.profile.bundles` 变更后 loader 会热挂载；**修改 lib/index.js 内容需要重启 DSH**。
- client 半：浏览器硬刷新（Cmd/Ctrl+Shift+R）。
- 路由自检：

```sh
curl -s http://127.0.0.1:<port>/dsh-mcp-studio/api/mcp
curl -s http://127.0.0.1:<port>/dsh-mcp-studio/api/skills
```

host 半可以在没有 DSH 的情况下冒烟测试：`node` 导入 `lib/index.js`，用带 `webServer` / `skills` / `connection` / `logger` / `on`
的 mock ctx 调 `apply(ctx, { profile: 'desktop' })`，应注册 **18** 条路由且不抛错（`.test/host-smoke.mjs` 就是它）。

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
- 产物只有 `lib/index.js`（ESM host）、`lib/client.js`（ModuleLoader CJS client + id `dsh-mcp-studio`）与
  `lib/restart-helper.js`（**独立进程**的重启助手：拉起它的 Host 随后会被 taskkill，内联进主 bundle 就会一起消失，
  所以它是第三个 esbuild 入口，host 侧按固定文件名定位）。
- `package.json` 的 `dsh.client.inject` 必须列出用到的官方客户端模块（layout / primitives / renderer / locale）。
- **面板有五个 tab**（`client/components/extension-panel.tsx` 的 `rows`）：市场（条件）/ 技能 / MCP / 已归档 / 服务。
  新 tab 一律**追加在末尾**：`rows[0]` 就是首屏默认页，插到前面会改掉所有人的默认页。tab 之间要跳转时用
  `render(onNavigate)` 传下去的 `setRequestedId`，不要自己造状态容器。
- **重启入口只有一个**：`service-tab.tsx`（「服务」页）。MCP 只保留「配置已写入，需要重启」的提示 + 跳转。
  别再往别的页面塞第二个重启按钮。
- 会话管理的服务层（`service/archive.ts`、`session-paths.ts`、`session-attachments.ts`、`pending-deletions.ts`）
  是**纯 Node**、不依赖 DSH 服务（靠 `ctx.get` 取），因此可以脱离 DSH 直接单测；它们的线协议类型在
  `service/archive.types.ts`，由 `routes/index.types.ts` 再导出给客户端。队列与重启日志的目录**保持**
  `$DSH_HOME/session-admin/`（改目录会让老队列的删除意图静默失效）。
- 中文注释解释“为什么”（约束、顺序、坑），不解释“是什么”。
- 任何行为变更都要同步 `README.md`、`README_EN.md`、`CHANGELOG.md`，并保留上游鸣谢与许可说明。
