/**
 * Build the consolidated plugin:
 *
 *   lib/index.js   — host half (ESM, node): the panel host plus the vendored dsh-tauri
 *                    host tools it relies on
 *   lib/client.js  — client half (CJS inside the DSH ModuleLoader factory)
 *
 * The Tauri edition shipped three packages that imported each other by bare specifier
 * (`dsh-tauri`, `dsh-tauri/client`, `dsh-tauri-ui/client`). This package vendors all
 * three and maps those specifiers onto the vendored sources, so the original sources
 * compile unmodified.
 *
 * esbuild is used instead of a rollup-based bundler because the DSH runtime's Node
 * enforces macOS library validation: rollup/rolldown `.node` bindings signed by another
 * Team ID fail to dlopen.
 */
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'

const id = 'dsh-mcp-studio'

/**
 * The Tauri edition imported its own packages by bare specifier; map those onto the
 * vendored sources so the original sources compile unmodified.
 */
const alias = {
  'dsh-tauri': './src/bridge/tauri-host.ts',
  'dsh-tauri/client': './src/bridge/tauri-client.ts',
  'dsh-tauri-ui/client': './src/bridge/tauri-ui.ts',
}

/**
 * Browser-only alias: a transitive CJS dependency requires Node's `util` for
 * `util.inspect`. The DSH client ModuleLoader has no `util` in its module table, so
 * the shim stands in. Never applied to the host build, where `node:util` is real.
 */
const clientAlias = {
  ...alias,
  util: './src/bridge/util-shim.ts',
  'node:util': './src/bridge/util-shim.ts',
}

/** Official DSH modules are provided by the host at runtime — never bundle them. */
const officialExternal = {
  name: 'official-external',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@deepseek-ai\// }, () => ({ external: true }))
  },
}

const shared = {
  bundle: true,
  target: 'es2022',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  alias,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [officialExternal],
}

await rm('lib', { recursive: true, force: true })
await mkdir('lib', { recursive: true })

// ---- host half -------------------------------------------------------------
await build({
  ...shared,
  entryPoints: ['src/panel/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})

// ---- client half -----------------------------------------------------------
await build({
  ...shared,
  entryPoints: ['src/panel/client/index.ts'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  alias: clientAlias,
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
})

// ---- restart helper (独立进程) ----------------------------------------------
// 重启助手必须是被 spawn 的、磁盘上真实存在的独立脚本：拉起它的 Host 随后会被
// taskkill 掉，内联在 lib/index.js 里的代码会跟着消失。所以它是第三个入口，
// 由 host 侧按 `lib/restart-helper.js` 的固定文件名定位。
await build({
  ...shared,
  entryPoints: ['src/panel/host/service/restart-helper.ts'],
  outfile: 'lib/restart-helper.js',
  format: 'esm',
  platform: 'node',
})

console.log(`built ${id}: lib/index.js + lib/client.js + lib/restart-helper.js`)