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
5. **No bundled skills any more (2.6.4)** — `/skill-creator` is a *skill*, not a built-in command: the host recognises
   only entries that really exist under a skill root. Upstream shipped anthropics/skills' `skill-creator` and
   vercel-labs/skills' `find-skills` through `files: ["skills"]`, and this repo restored both (2.0.x–2.6.3); 2.6.4
   removes them (`find-skills` is identical to `~/.agents/skills/find-skills`, and `skill-creator` now lives in the
   user's `~/.agents/skills`). **Consequence**: without the skill installed the prefilled `/skill-creator` is plain
   text (no highlight, no click-through, nothing loads on send), so the Skills tab checks whether it is listed and
   disables **New skill** with a tooltip explaining how to install it.
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

- **Skills** (list with a **source-category filter** — project / user / runtime / bundled — plus search, enable/disable,
  view/edit SKILL.md, create — opens a new conversation in the
  current workspace with `/skill-creator` prefilled — delete, open folder, refresh),
- **Plugins** (**packages only (npm bundles)**: icon + name + one-line description + version + state; `All / Third-party /
  Official` filter (third-party by default), search (package name, title, description), **package-level
  enable/disable**, **uninstall** (only for bundles the official service marks removable, with confirmation), **update
  check & one-click update** (checked once on entry, 10-minute cache, updatable packages
  pinned to the top with a `0.6.4 → 0.6.5` badge; "Update to x.y.z" asks for confirmation first), and **undo of the
  last change** when a toggle fails; the **Plugin market** button opens the official Plugins page straight on its
  **Discover** tab. **No Loader entries** — fine-grained entry switches live on the official Plugins page),
- **Sessions** (archived sessions **grouped by workspace** — groups collapsed by default, click a workspace to see its
  sessions; sessions without a workspace fall into a trailing "No workspace" group; each group header carries the name,
  session count, disk usage and pending count. **Select-all spans every group including collapsed ones**, and each group
  has its own select-all / indeterminate state. Each row still shows the **session title + short id**. Bulk delete runs a
  dry-run plan → confirmation → **deletes the files immediately** (the archive tombstone is cleared at the next start, so
  both surfaces are clean right away); queued entries and their cancellation are covered below),
- **MCP** (list, add/edit, enable/disable, connection check, copy, import scanning, JSON export/import; a write shows
  a "restart needed" banner),
- **restart control (top-right)**: a single **restart service**. It is **not disabled by running work** — only "not the
  desktop app" or "already restarting" disables it; clicking it re-reads the active-work report, and the tooltip plus
  the confirmation dialog say what a restart will interrupt.

> Since 1.2.0 the **community market `dshmarket` is no longer embedded**. Since 2.1.0 the **Plugin market** button
> opens the **official** Plugins page (`@deepseek-ai/dsh-plugin-market` / `dsh-client-ui-plugin-market` only register a
> `discover` tab there and export no reusable component), so this panel does not rebuild that UI. Since 2.2.0 it also
> switches that page to the **Discover** tab.

### 🔌 Plugins and the market entry

#### Why "hundreds of plugins" when you installed a handful

The official `listPlugins()` lists **Loader entries**, not packages: DSH splits itself into a few hundred cordis plugin
entries (227 on this machine — `dsh-base` alone declares 87 and `dsh-web-app` 96), while **you installed 6 packages**.

So this tab **only talks about packages** (`listBundles()`): one card per npm package, **no Loader entries**; the
filter defaults to **Third-party** (`official === false`), so opening it shows just the few you installed.
(Fine-grained entry switches — such as turning off one internal module — belong to the official Plugins page, which
lists every row of a package.)

- Package data comes from the official `pluginManager.listBundles()`: `official` (shipped by DSH or listed in the market
  catalog), `installed`, `enabled`, `version`, `availability`, plus the **localized display metadata**
  `meta.title` / `meta.description` / `meta.icon` (the icon is a base64 data URL shipped by the package; anything above
  64 KiB is not forwarded). Text is resolved in the runtime language (`ctx.locale.resolveText`) — this plugin never
  guesses a language.
- **Package toggles** use `setBundleEnabled(name, enabled)` (adds/removes that layer in the profile's
  `dsh.profile.bundles`), applied by the official service: comments and `!!js` expressions preserved, atomic write,
  file lock — this plugin never writes YAML itself.
- The outcome is surfaced verbatim: `applied` (immediate on a profile with hmr) / `restart-required` /
  `overridden` (a higher-priority patch wins) / `failed` (with the official code and diagnostic).
  **A `failed` outcome still wrote the file**, so the page keeps an **undo the last change** action.
- Packages that cannot be toggled say why: `management-required` (plugin management itself needs it) or
  `unaddressable` (this profile's patch cannot address the item uniquely) — the same wording as the official page.
  **Package-level switches are disabled for official packages** (uninstall/catalog duties belong to the official page);
  third-party packages are what this tab operates on.
- **dsh-toolshed cannot be disabled from here**: it is not in the official protected set, and disabling it would make
  the panel vanish with no way back, so the host refuses with 409 `self-management`.
- Without a `pluginManager` service (no profile, or DSH < 0.2.2) the route answers 503 `plugin-manager-unavailable` and
  the page says so instead of pretending the list is empty.
- **The visible set matches the official Plugins page**: the official page hides the bundles that have no page of
  their own — the base compositions of other profile templates (`dsh-base`, `dsh-web-app`, `dsh-headless`, `dsh-sdk-app`,
  `dsh-sdk-minimal`, `dsh-acp-app`), the persistent terminal bundle and the worktree tool. This page hides them too
  (so you will not see `dsh-sdk-app` / `dsh-sdk-minimal`: they are not prerequisites, they are the base bundles of the
  `sdk` / `sdk-minimal` profile templates — and `dsh-base` cannot be switched off at all). The list mirrors the official
  `HIDDEN_BUNDLES`; when the two disagree, the official page wins.

The **Plugin market** button opens an **Install plugin** dialog (it does **not** rebuild the official Discover page):

- Type a `package name` / `name@1.2.3` / `git+https://…` / local path / tarball URL → **Check** → see what was recognised
  (name, version, one-line description, whether it is a DSH bundle at all; git and tarball specs can only be confirmed
  once installed).
- **Install** goes through the official `pluginManager.installBundle()` — this panel never runs pnpm itself and never
  writes `package.json`. When the package needs to run **build scripts**, the host installs nothing and answers with
  `pendingBuilds`; the dialog lists those packages and **Allow and continue** retries with `approvedBuilds`.
- The outcome is reported verbatim: `applied` / `restart-required` (restart DSH), or the failure kind (network, package
  not found, pnpm missing, unapproved scripts, …) plus the tail of the pnpm output, ready to paste into an issue.
- The **market catalog** (your indexes, search, detail pages, version lists) still lives on the official page: the
  dialog's footer button opens the official Plugins page on its Discover tab.

> Why not embed the official Discover page: the market client only exports `apply` (it registers its `DiscoverSection`
> into the official page's `plugins.tab`), with no component and no `render()`; cloning it would drift along with the
> market index and detail-document formats. And "install a package by name" does not need the index at all — it is a
> thin shell over the official `installBundle`.

#### Updates

- **Checked once when you open the Plugins page** (`update === 'registry'` packages only, serial, never blocking the
  list), cached for 10 minutes; **Check for updates** re-runs it on demand (a manual run reports failures, the automatic
  one stays silent).
- **Re-sorted once after the whole check settles**: updatable packages go to the top; everything else keeps the
  third-party → official → name order.
- Updatable cards show a `0.6.4 → 0.6.5` badge plus an **Update to 0.6.5** button; **every update asks for
  confirmation** (current → target plus the answering registry), then shows progress and the result.
- Candidates follow the official rule: `bundle`, compatible with the running dsh, **not deprecated and not a
  prerelease** — a version that would not boot is never offered.
- **An update removes the old version before installing the new one**: when the new one fails the official service puts
  the old version back, and the page says so ("rolled back to x.y.z").
- `link:` dependencies (such as `dsh-toolshed` itself) have no `update` field and never show an update entry;
  `update === 'git'` packages need a spec pinned to a full commit, so this panel does not check them automatically and
  only points at the official page.

> Why not navigate to the official detail page on click: `pluginNavigation.openBundle()` **switches the main panel** —
> the Toolshed page unmounts (filters and search lost) and coming back lands on the first tab (Skills), while the detail
> page's own back button only returns to the official Installed list. So updating happens in-page; detail/uninstall/pick
> a version stay behind the **Plugin market** button, which explicitly means "go to the official page".

#### Uninstall

- The **Uninstall** action only appears when the official service marks the bundle **removable**
  (`BundleInfo.removable`): profile-owned dependencies (including official optional bundles installed from the market's
  Discover tab) are removable; bundles shipped with the DSH installation are not, so they have no button at all.
- Uninstall asks for confirmation, then calls the official `removeBundle`: **deselect it from the bundle list →
  `pnpm remove` → reload**. That is the difference from disabling: disabling only edits the bundle selection, while
  uninstalling drops the dependency from the profile (`link:` targets are not deleted).
- **dsh-toolshed itself has no Uninstall action** (the service also refuses with 409 `self-management`): removing the
  panel makes it vanish with no way back.
- The official refusal codes (`not-removable` / `stop-profile` / `bundle-in-use`) are shown verbatim.

> **Known limitation (fragile)**: to funnel the entry points into this panel, `register/sidebar-tweaks.ts` hides the
> sidebar's own **Plugins** row (the official build hard-codes it as always present, so it never gets lost) and hides
> **More** only when that is safe. `ctx.slots` has no "hide / conditional registration" and cannot unregister another
> plugin's entries, so this is a **DOM patch**: it only uses semantic anchors (`data-slot="sidebar.panellist"`, an
> `aria-label` resolved from the slot entry's own label, `aria-haspopup="menu"`), never hashed class names or
> nth-child, and it fails open. A structural change in the sidebar may simply make the rows reappear (no error, and the
> Toolshed row is never affected).
>
> **Why More must not be hidden unconditionally**: the sidebar renders "pinned plus the fixed Plugins row", and an entry
> you **unpin** only exists inside the **More** menu — which is also the only place to pin it back — while the pin state
> itself is **in memory** (a refresh restores it). Hiding More therefore locks entries behind a closed door. This plugin
> hides More only when "rendered rows ≥ registered panels" (i.e. nothing is unpinned); the moment an entry disappears
> from the list, More comes back as the way out. The patch targets the DSH 0.2.x structure and must be re-verified on a
> major upgrade; to restore the stock sidebar, drop the `ctx.effect(sidebarTweaksFeature, …)` line
> in `client/index.ts`.

### 🗂 Archived sessions

The list is **grouped by workspace first**: one header row per workspace (name + session count + that group's disk usage
+ pending count); click it to reveal that workspace's sessions. Sessions without workspace information go to a
"No workspace" group pinned at the bottom. **Selection is independent of collapsing**: the top-right select-all covers
every workspace, each group also has its own select-all (with its own indeterminate state), and the header shows
selected/total. Groups are ordered by workspace name (a fixed `zh-Hans-CN` collation, so the same list does not reorder
between machines); **rows inside a group keep the Host's order**.

DSH can archive and unarchive but has **no delete API**. This tab adds it, with explicit rules:

- Only registry-archived sessions are eligible; ids must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`.
- **Deletion takes effect immediately** (2.7.2): the log directory, the projection cache and unreferenced attachments
  are removed right away, so disk space is freed at once.
- **The archive tombstone is not cleared on the spot; it is cleared on the next start.** Clearing it makes the host's
  in-memory session show up in the native sidebar as an **Ungrouped** empty shell (observed on a real machine). While the
  tombstone stays, the session still counts as archived, so the sidebar never lists it — and this page **filters out
  archived rows whose log directory is gone**, so both surfaces are clean immediately. The start-up sweep then clears
  those **orphan tombstones** (`detachSession` / `unpinSession` / `unarchiveSession`).
- Only sessions **still live in memory** cannot be deleted now (the host holds an Agent handle); they are queued in
  `$DSH_HOME/session-admin/pending-deletions.json` and run on the next start. The page only mentions them when such
  entries actually exist, and offers "cancel pending".
- Deletion covers the whole per-session log directory, the projection cache, schedules bound to the session and the
  workspace slot (the archive tombstone is cleared at start-up).
- **Attachments (on by default)** are removed only after a complete reference scan of every remaining session plus
  the upload index proves nothing else uses them; an incomplete scan removes **nothing** and reports why.
- Unarchiving cancels the pending deletion immediately (workspace `domain/changed` listener + a sweep on every read).

### 🔄 Restart control (top-right)

A process-level restart (DSH exposes no restart API to plugins): one click + one confirmation writes a restart plan,
spawns the detached helper `lib/restart-helper.js`, replies, then `taskkill /T`s the current Electron process tree; the
helper waits for the old process to exit and relaunches the same executable as a GUI app, and the page reloads once the
host is back. Log: `$DSH_HOME/session-admin/restart.log`.

**There is no safety gate** (since 2.6.0): active work never disables or refuses a restart. It is still reported —
running turns, queued input and running/stopping jobs (archived sessions exempt) — purely so the tooltip and the
confirmation dialog can tell you **what a restart will interrupt** ("running session ×2, background job ×1"). Confirm
and it runs: by the time you click, you have already decided nothing needs to keep running.

Clicking **restart service** re-reads `GET /api/host/restart` first, so the confirmation dialog shows the state as of
that click. (2.6.1 dropped the separate refresh button: with the safety gate gone it only refreshed a line of copy, so
it had no reason to exist.) **Desktop only** (detected via
`ELECTRON_RUN_AS_NODE=1` + an argv entry containing `dsh-desktop-host` + a real parent process); Web / CLI report it as
unavailable — killing that process would leave nobody to relaunch it, so that one check stays.

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
