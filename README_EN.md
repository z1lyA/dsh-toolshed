<div align="center">

<img src="assets/icon.png" alt="dsh-toolshed" width="128" />

# dsh-toolshed

**The tool-surface manager for DeepSeek Harness: MCP servers, Skills, archived sessions, plus a host restart — all behind one sidebar entry.**

[![dsh-toolshed](https://img.shields.io/badge/dsh--toolshed-DSH%20plugin-4d6bfe.svg)](https://github.com/z1lyA/dsh-toolshed)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-lightgrey.svg)](https://github.com/z1lyA/dsh-toolshed)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

[Issues](https://github.com/z1lyA/dsh-toolshed/issues) • [Changelog](CHANGELOG.md) • [简体中文](README.md) •
Forked from [functy23/dsh-mcp-studio](https://github.com/functy23/dsh-mcp-studio)

</div>

---

> **Why the rename**: this started as a fork of `dsh-mcp-studio` (MCP / Skills only). It then absorbed the archived
> session manager and desktop process restart from [z1lyA/dsh-session-admin](https://github.com/z1lyA/dsh-session-admin),
> so both its scope and its identity changed — and the npm name `dsh-mcp-studio` belongs to the original author, so a
> fork cannot publish under it. Hence **`dsh-toolshed`** as an independent project (plugin id, route prefix and
> artifact id all changed; old versions must be uninstalled before installing this one). The upstream MIT licence and
> its additional terms still apply — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 📦 What this is

The Tauri desktop edition ([deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop))
ships its extension panel (Skills / MCP / plugin market) as **three mutually dependent packages**:

| Upstream package | Role | Depends on |
| --- | --- | --- |
| `dsh-tauri-panel-extension` | the panel itself: Skills / MCP / market tabs + host routes | `dsh-tauri`, `dsh-tauri-ui` |
| `dsh-tauri` | host + client framework bridge (`defineRoutes`, `defineService`, `definePanel`, `defineRegister`, locale, store) | — |
| `dsh-tauri-ui` | components used by the panel (Button/Chip/Modal/SegmentedControl/PanelPage/icons…) | `dsh-tauri` |

Installing MCP management meant installing all three, and it only worked inside the Tauri build.

**dsh-toolshed consolidates them into a single package**: the upstream sources are vendored as-is
(`src/panel`, `src/vendor/dsh-tauri`, `src/vendor/dsh-tauri-ui`), a build-time alias layer (`src/bridge`)
maps the old bare specifiers onto those local files, and only the minimum changes needed for
cross-platform support are applied. **No UI was rewritten.**

## ✨ How the integration works

```
src/                  ← live code: everything reachable from the product entries
  panel/              the extension panel, verbatim (host services + routes, client components/register/locales/styles)
  vendor/dsh-tauri/   the framework bridge it imports, verbatim (Tauri-only invoke/iframe modules stay unused)
  vendor/dsh-tauri-ui/ the components it imports, verbatim
  bridge/             build-time module mapping: old bare specifier → local file

vendor-archive/       ← vendored subtrees unreachable from the product entries (Tauri-only bridges,
                        tests of modules that were never vendored); out of build / typecheck / tests

skills/               ← skills shipped with the package (host half mounts them via package.json "files")
  skill-creator/        the /skill-creator prefill only works because it exists
  find-skills/          byte-identical to the upstream release artifact
```

Two artifacts — three since 1.1.0: `lib/index.js` (host half, ESM), `lib/client.js` (client half, DSH ModuleLoader CJS)
and `lib/restart-helper.js` (the restart helper, which must run as a **separate process**: the host that spawns it is
killed right after, so inlining it into the main bundle would take it down too).

### Cross-platform changes (three adaptations + behaviour fixes)

1. **Module mapping** — `dsh-tauri`, `dsh-tauri/client`, `dsh-tauri-ui/client` resolve to `src/bridge/*`, so upstream imports are untouched.
2. **Profile detection** — upstream only honoured `--profile`; `DSH_PROFILE`, `DSH_PROFILE_DIR` and the
   `<DSH_HOME>/profiles/<name>` launcher argument are now detected too, so MCP rows land in the right profile.
3. **Own identity** — plugin id and route prefix are `dsh-toolshed` (`/dsh-toolshed/api/*`), distinct from both the Tauri plugin and the upstream `dsh-mcp-studio`, so it coexists with either.
4. **"New skill" flow** — upstream only ran "workspace → `connectWorkspace` opens a session", while 0.1.7 moved
   navigation to `uiWorkspace`. The panel now walks four rungs: official `sessions.create({ workspaceId })` opens a
   **new conversation in the workspace of the current session** → the adapter-projected `workspaces.connectWorkspace`
   → a session that belongs to no workspace is followed by its `cwd` → reuse of the active session only when nothing
   else can host the draft. Clicking "New skill" no longer hijacks the conversation you are writing in.
5. **Bundled `skills/`** — `/skill-creator` is a *skill*, not a built-in command: the host recognises only entries
   that really exist under a skill root. Upstream shipped anthropics/skills' `skill-creator` and vercel-labs/skills'
   `find-skills` through `files: ["skills"]`; this repo restores both, byte-identical to the upstream release
   artifact. Without them the prefilled `/skill-creator` is plain text — no highlight, no click-through, and nothing
   loads on send.
6. **Plugin-market embedding removed (1.2.0)** — upstream only embedded `dshmarket` inside the Tauri iframe
   (`window.parent !== window`); 1.0.5 made it appear whenever `render` was published. Since 1.2.0 the whole
   integration is **gone**: the market is a separate, low-frequency plugin and does not deserve a tab here, so an
   installed `dshmarket` simply keeps its own settings-page entry.

Tauri-only code (invoke / listen / iframe bridges) stays vendored but unreferenced: the bundle never touches `window.__TAURI__`.

## 🚀 Install

Install into whichever profile you use:

```sh
dsh plugin --profile web     add dsh-toolshed@latest   # DSH Web (use the link install below until it is on npm)
dsh plugin --profile desktop add dsh-toolshed@latest   # DSH Desktop
```

> **About `dsh.client.platform: web`** — `web` names the *client kind* (the Web GUI), not a profile. The Web and
> Desktop profiles both run `@deepseek-ai/dsh-web-app`, the same client, so both work; this plugin's client half
> depends on that client's official modules (ui-layout / ui-primitives / ui-renderer / locale).
>
> **The Tauri edition is out of scope**: it ships its own native extension panel plugins. This repository only
> vendors those three packages into one cross-profile plugin; the bundle carries no Tauri runtime dependency and
> does not replace the Tauri edition's native plugins.

> **Do not install this alongside `dsh-session-admin`** — 1.1.0 already contains its whole feature set (archived
> session deletion, pending queue, process-level restart). Both plugins would read/modify the same
> `$DSH_HOME/session-admin/pending-deletions.json` and register duplicate `domain/changed` listeners on the
> `workspace` domain. Upgrade path: link this package in and confirm the new tabs, then remove the old one
> (`plugin_manager({ action: "remove_bundle", target: "dsh-session-admin" })`; if it reports `bundle-in-use`,
> drop it from `dsh.profile.bundles`, delete the `link:` entry from `dependencies`, then
> `pnpm install --offline --dir <profile>`).

Restart DSH once after a host-half update, then hard-refresh the browser.

## 🧭 UI

The sidebar shows **工具管理 / Toolshed** (Puzzle icon) with four tabs (order: Skills / Plugins / Sessions / MCP), and
the **top-right corner of the tab row** holds refresh + restart:

- **Skills** (grouped list, search, enable/disable, view/edit SKILL.md, create — opens a new conversation in the
  current workspace with `/skill-creator` prefilled — delete, open folder, refresh),
- **Plugins** (**by package (npm bundle)**: icon + name + one-line description + version + state; `All / Third-party /
  Official` filter (third-party by default), search (package name, title, description, inner module names),
  **package-level and row-level enable/disable**, expand to see the Loader rows, and **undo of the last change** when a
  toggle fails; the **Plugin market** button opens the official Plugins page straight on its **Discover** tab),
- **Sessions** (archived sessions — each row shows the **session title + short id**, see below),
- **MCP** (list, add/edit, enable/disable, connection check, copy, import scanning, JSON export/import; a write shows
  a "restart needed" banner),
- **restart control (top-right)**: refresh (re-check whether a restart is possible) + restart service.
  When a restart is not possible the button is disabled and its tooltip lists the reason — running sessions, queued
  input, background jobs, or "not the desktop app".

> Since 1.2.0 the **community market `dshmarket` is no longer embedded**. Since 2.1.0 the **Plugin market** button
> opens the **official** Plugins page (`@deepseek-ai/dsh-plugin-market` / `dsh-client-ui-plugin-market` only register a
> `discover` tab there and export no reusable component), so this panel does not rebuild that UI. Since 2.2.0 it also
> switches that page to the **Discover** tab.

### 🔌 Plugins and the market entry

#### Why "hundreds of plugins" when you installed a handful

The official `listPlugins()` lists **Loader entries**, not packages: DSH splits itself into a few hundred cordis plugin
entries (227 on this machine — `dsh-base` alone declares 87 and `dsh-web-app` 96), while **you installed 6 packages**.
So this tab is **package-oriented** (`listBundles()`); entries only appear when you expand a package. The header count
reads "N packages · M entries" to make that explicit, and the filter defaults to **Third-party** (`official === false`).

- Package data comes from the official `pluginManager.listBundles()`: `official` (shipped by DSH or listed in the market
  catalog), `installed`, `enabled`, `version`, `availability`, plus the **localized display metadata**
  `meta.title` / `meta.description` / `meta.icon` (the icon is a base64 data URL shipped by the package; anything above
  64 KiB is not forwarded). Text is resolved in the runtime language (`ctx.locale.resolveText`) — this plugin never
  guesses a language.
- **Package toggles** use `setBundleEnabled(name, enabled)` (writes the profile's `dsh.profile.bundles`);
  **row toggles** use `setPluginEnabled(entryId, enabled)` (writes the profile's `cordis.patch.yml`). Both are applied
  by the official service: comments and `!!js` expressions preserved, atomic write, file lock — this plugin never
  writes YAML itself.
- The outcome is surfaced verbatim: `applied` (immediate on a profile with hmr) / `restart-required` /
  `overridden` (a higher-priority patch wins) / `failed` (with the official code and diagnostic).
  **A `failed` outcome still wrote the file**, so the page keeps an **undo the last change** action.
- Items that cannot be toggled say why: `management-required` (plugin management itself needs it) or `unaddressable`
  (this profile's patch cannot address the item uniquely) — the same wording as the official page.
  **Package-level switches are disabled for official packages** (uninstall/catalog duties belong to the official page);
  their **rows** can still be toggled individually.
- **dsh-toolshed cannot be disabled from here**: it is not in the official protected set, and disabling it would make
  the panel vanish with no way back, so the host refuses with 409 `self-management` (both row and package level).
- Without a `pluginManager` service (no profile, or DSH < 0.2.2) the route answers 503 `plugin-manager-unavailable` and
  the page says so instead of pretending the list is empty.

The **Plugin market** button does **not** reimplement the market: it opens the official Plugins page via
`pluginNavigation.openList()`, falling back to `ctx.layout.selectPanel('plugins')`, and then **clicks that page's
Discover tab** (the official API only exposes `openList` / `openBundle`, both pinning the page to Installed, so this
last step is a DOM fallback: the `${tabsId}-<tabId>` id suffix or the tab label; when it misses, the page simply stays
on Installed). If neither entry point exists the button is not rendered.

> **Known limitation (fragile)**: to funnel the entry points into this panel, `register/sidebar-tweaks.ts` hides the
> sidebar's own **Plugins** and **More** rows. `ctx.slots` has no "hide / conditional registration" and cannot
> unregister another plugin's entries, so this is a **DOM patch**: it only uses semantic anchors
> (`data-slot="sidebar.panellist"`, an `aria-label` resolved from the slot entry's own label, `aria-haspopup="menu"`),
> never hashed class names or nth-child, and it fails open. A structural change in the sidebar may simply make the
> rows reappear (no error, and the Toolshed row is never affected). The patch targets the DSH 0.2.x structure and must
> be re-verified on a major upgrade; to restore the stock sidebar, drop the `ctx.effect(sidebarTweaksFeature, …)` line
> in `client/index.ts`.

### 🗂 Archived sessions

DSH can archive and unarchive but has **no delete API**. This tab adds it, with explicit rules:

- Only registry-archived sessions are eligible; ids must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`.
- **Sessions still live in memory are never force-deleted**: the host keeps an Agent handle once a conversation was
  opened, and deleting the log under it makes the backend recreate a headerless log. Such sessions (and their
  subagent descendants) are queued in `$DSH_HOME/session-admin/pending-deletions.json` and executed on the
  **next DSH start**; the page shows "pending" and lets you cancel at any time.
- Deletion covers the whole per-session log directory, the projection cache, schedules bound to the session, the
  workspace slot and the archive tombstone.
- **Attachments (on by default)** are removed only after a complete reference scan of every remaining session plus
  the upload index proves nothing else uses them; an incomplete scan removes **nothing** and reports why.
- Unarchiving cancels the pending deletion immediately (workspace `domain/changed` listener + a sweep on every read).

### 🔄 Restart control (top-right)

A process-level restart (DSH exposes no restart API to plugins): the host inspects running turns, queued input and
running/stopping jobs (archived sessions exempt); when there is active work the button is **disabled** and its
tooltip lists the blockers. Otherwise one click + one confirmation writes a restart plan, spawns the detached helper
`lib/restart-helper.js`, replies, then `taskkill /T`s the current Electron process tree; the helper waits for the old
process to exit and relaunches the same executable as a GUI app, and the page reloads once the host is back.
Log: `$DSH_HOME/session-admin/restart.log`. The refresh button re-reads `GET /api/host/restart`, so the control
re-enables as soon as the blocking work is gone. **Desktop only** (detected via `ELECTRON_RUN_AS_NODE=1` + an argv
entry containing `dsh-desktop-host` + a real parent process); Web / CLI report it as unavailable.

<p align="center">
  <img src="assets/screenshot-skills.png" alt="Extension panel · Skills" width="720" /><br/>
  <img src="assets/screenshot-mcp.png" alt="Extension panel · MCP" width="720" />
</p>

## 🛠 Development

```sh
pnpm install
pnpm typecheck     # tsc --noEmit (currently clean)
pnpm build         # node scripts/build.mjs → lib/index.js + lib/client.js + lib/restart-helper.js
pnpm test          # node scripts/run-tests.mjs (vitest; see below)
```

**Remotes (this project is a standalone repository, no longer a fork):**

| remote | points at | purpose |
| --- | --- | --- |
| `origin` | `z1lyA/dsh-toolshed` | this project (standalone) |
| `upstream` | `functy23/dsh-mcp-studio` | read-only reference — cherry-pick upstream framework fixes |
| `fork-archive` | `z1lyA/dsh-toolshed-fork` | pre-detach backup, **archived (read-only)**; delete it on GitHub once you no longer need it (deleting needs the `delete_repo` scope: `gh auth refresh -s delete_repo`, or Settings → Danger Zone) |

> esbuild is used deliberately: the DSH runtime's Node enforces macOS library validation, and
> rollup/rolldown `.node` bindings fail to dlopen (see [AGENTS.md](AGENTS.md)).
>
> `pnpm test` is not a bare `vitest run`: the rollup native binding that vite loads is unsigned and the
> bundled DSH Node runs with the hardened runtime, so both ends fail `dlopen`. `scripts/run-tests.mjs`
> signs the binding ad-hoc and then runs vitest under a Node without the hardened runtime.
>
> The old bare specifiers are mapped in three places — `scripts/build.mjs`, `tsconfig.json` and
> `vitest.config.ts`: change all three together.

## 🙏 Credits

- **[deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop)** by Hairyf and contributors —
  the panel, the framework bridge and the UI components in this repository are their original work,
  vendored here. Please support the upstream project and its Tauri desktop edition.
- **[z1lyA/dsh-session-admin](https://github.com/z1lyA/dsh-session-admin)** — the 1.1.0 "Archived" tab and the
  Service-tab restart (+ the top-right restart control) are ported from that plugin (deletion rules, pending queue,
  desktop process-level restart); the MIT licence and our changes are recorded in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Official plugin docs: <https://deepseek-harness.github.io/deepseek-harness/develop/basic/>

## 📄 License

MIT, with the upstream additional terms ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):
no commercial secondary development.
