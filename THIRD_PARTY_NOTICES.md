# THIRD PARTY NOTICES

本仓库的 `src/panel`、`src/vendor/dsh-tauri`、`src/vendor/dsh-tauri-ui` 目录**搬运自**：

- **deepseek-harness-desktop** — <https://github.com/dsh-tauri-desk/deepseek-harness-desktop>
  - 来源包：`packages/dsh-tauri-panel-extension`、`packages/dsh-tauri`、`packages/dsh-tauri-ui`
  - 作者：Hairyf 与 deepseek-harness-desktop 贡献者
  - 许可：MIT，**附加条款**如下

```text
MIT License

Copyright (c) 2026 deepseek-harness-desktop contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Additional Terms — No Commercial Secondary Development

This file supplements the MIT License in the LICENSE file. In addition to the
rights and conditions granted there, the following condition applies to the
Software:

1. No Commercial Secondary Development: The Software may not be used for
   secondary development (including but not limited to modification,
   adaptation, or derivation) for commercial gain, monetary compensation,
   or as part of a paid commercial product or service. Direct use of the
   Software itself for commercial purposes remains permitted.

In the event of any conflict between the MIT License and these additional
terms, these additional terms prevail.

Copyright (c) 2026 deepseek-harness-desktop contributors

## anthropics/skills / vercel-labs/skills（随包技能）

- `skills/skill-creator` — <https://github.com/anthropics/skills>，Apache-2.0，`LICENSE.txt` 一并保留
- `skills/find-skills` — <https://github.com/vercel-labs/skills>，MIT，`LICENSE` 一并保留
- 两个目录都取自上游 `dsh-tauri-panel-extension` 的发布产物（`files: ["skills"]`），**逐字节相同**

「新建技能」预填的 `/skill-creator` 是一条**技能**而不是内置命令：宿主只把技能目录里真实存在的
条目认成 `/名字`，所以这个目录必须随包发布，否则输入框里的 `/skill-creator` 只是普通文本
（不高亮、点不开、发送后也不会加载任何技能）。

---

## z1lyA/dsh-session-admin（「已归档」tab 与进程级重启）

- 来源：<https://github.com/z1lyA/dsh-session-admin>（作者即本 fork 的维护者）
- 许可：MIT（见该仓库 LICENSE）
- 搬运范围（`src/panel/host/service/`）：
  - `session-paths.ts` ← `lib/paths.js`
  - `session-attachments.ts` ← `lib/attachments.js`
  - `pending-deletions.ts` ← `lib/pending.js`
  - `archive.ts` ← `lib/archive.js`
  - `restart-helper.ts` ← `lib/restart-helper.js`
  - `restart.ts` ← `lib/restart.js`（替换了本仓库 1.0.x 自带的 `dsh` CLI 语义重启实现）
- 搬运方式：逻辑 1:1，仅做 JS → TS 迁移（类型、`ctx` 最小面 `{ get, logger }`）、把「裸 `webServer.register`
  + 手写信任栅门」换成 `defineRoutes`（回环 / Origin / 405 / OPTIONS / 1 MiB body 由其统一承担）、
  删除 `lib/http.js`（等价实现不再需要）、删除 `unarchive` 之外的死代码；界面从 session-admin 的
  `React.createElement` 页面改写为本仓库的 CSSR + `dsh-tauri-ui` 组件（`.dshp-extension__*`），
  视觉与交互与其余 tab 一致。
- 边界语义未改：只删归档会话、live 会话排队到下次启动、整棵日志目录、投影缓存、绑定定时任务、
  附件「完整扫描后才删」、取消归档清队列、`$DSH_HOME/session-admin/` 目录（队列与重启日志）保持不变。

---

## 本项目（dsh-toolshed）的改动

- 本项目 fork 自 **[functy23/dsh-mcp-studio](https://github.com/functy23/dsh-mcp-studio)**（MIT，含
  「No Commercial Secondary Development」附加条款），2026-11-13 更名 **dsh-toolshed** 独立立项；
  上游作者与该仓库的全部版权声明继续适用，见上方 LICENSE 与附加条款。
- 上游三个包的源码原样搬运，仅调整模块解析（`src/bridge/`，构建期映射旧裸包名）。
- `src/panel/host/service/profile.ts`：补充 `DSH_PROFILE` / `DSH_PROFILE_DIR` / 启动参数探测，使其在 DSH Web / Desktop 上正确解析当前 profile。
- 插件 id 与 HTTP 路由前缀为 `dsh-toolshed`（`/dsh-toolshed/api/*`），与上游插件 id 不同，可共存。
- 移除对 Tauri 运行时的引用路径：Tauri 专属模块（invoke / listen / iframe 桥）保留在 vendor 中但不被任何入口引用，产物不会访问 `window.__TAURI__`。
- 补回上游随包的 `skills/`（`skill-creator` + `find-skills`，与上游发布产物逐字节相同；
  `package.json` 的 `files` 同步补 `skills`），见上。
- **1.1.0**（沿用上游版本号序列）：面板新增「已归档」与「服务」两个 tab；`/host/restart` 的实现被换成本仓库
  维护者自己那套桌面进程级重启（见上一节），构建新增第三个入口 `lib/restart-helper.js`；路由行数 13 → 18。
- **1.2.0**：取消「服务」页，重启改到标签页行最右侧（`components/restart-control.tsx`）；移除插件市场收编
  （上游 `dsh-tauri-panel-extension` 的 market tab 代码随 `src/panel` 一起搬运，但本仓库不再启用）。
- **2.0.0**：更名 `dsh-toolshed`（包名、插件 id、路由前缀、client bundle id 全改），侧边栏入口
  「扩展管理」改为「工具管理」。

除上述改动外，界面与 host 逻辑版权归上游作者所有。
