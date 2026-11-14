/**
 * 产物自检：确认客户端/host 产物没有 Tauri 运行时符号、中文字典是原文、新端点都在，
 * 并且**已经移除**的东西不再出现在产物里。
 *
 * 为什么需要解码：esbuild 默认把非 ASCII 字符串转义成 `\uXXXX`（既是历史行为，也让产物在
 * 任何终端里都不乱码），所以直接 grep 中文会假阴性——这里先把转义还原再比对。
 *
 * 用法：node .test/artifact-check.mjs
 */
import { readFileSync } from 'node:fs'

const files = ['lib/index.js', 'lib/client.js', 'lib/restart-helper.js']
let failures = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const tauri = text.split('__TAURI__').length - 1
  console.log(`${file}: __TAURI__ x${tauri}, ${(text.length / 1024).toFixed(0)} KB`)
  if (tauri !== 0) {
    console.error(`  !! ${file} 引用了 Tauri 运行时`)
    failures += 1
  }
}

/** esbuild 的 `\uXXXX` → 原字符。 */
function decode(text) {
  return text.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

const client = decode(readFileSync('lib/client.js', 'utf8'))
const host = decode(readFileSync('lib/index.js', 'utf8'))

const present = [
  [client, '已归档'],
  [client, '重启服务'],
  [client, '工具管理'],
  [client, 'archiveTab'],
  [client, 'restartNow'],
  [client, 'dshp-extension__head-actions'],
  [client, '/host/restart'],
  [client, '"/archived"'],
  [host, '/dsh-toolshed/api/archive/plan'],
  [host, '/dsh-toolshed/api/host/restart'],
  [host, 'pending-deletions.json'],
  // 2.1.0：第四个 tab「插件」（清单 + 启停 + 官方页里的市场入口）
  [client, 'pluginsTab'],
  [client, '插件市场'],
  [client, 'pluginMarketHint'],
  [client, 'pluginUndo'],
  // 2.2.0：插件 tab 改成以「包」为单位（图标 + 标题 + 一句话简介 + 官方/第三方筛选），
  // 并且市场入口会直接点到官方页的「发现」tab
  [client, 'pluginsIntroV2'],
  [client, 'pluginOfficialManage'],
  [client, 'pluginShowAll'],
  [client, '/plugins/bundle/toggle'],
  // 侧栏「插件」「更多」两行的 DOM 兜底：标记属性与语义锚点都必须在产物里
  [client, 'data-toolshed-hidden'],
  [client, 'aria-haspopup'],
  [client, 'sidebar.panellist'],
  [host, '/dsh-toolshed/api/plugins/bundle/toggle'],
  [host, '/dsh-toolshed/api/plugins'],
  [host, '/dsh-toolshed/api/plugins/toggle'],
  [host, 'plugin-manager-unavailable'],
]

const absent = [
  // 1.2.0 起：市场与「服务」页都从面板里移除了。
  // 2.1.0 的「插件市场」入口走的是**官方插件页**（dsh-plugin-market / ui-plugin-market），
  // 不是当年社区那个 dshmarket —— 所以这三条继续必须为 0。
  [client, 'marketTab'],
  [client, 'MarketTab'],
  [client, 'serviceTab'],
  [client, 'dshmarket'],
]

for (const [text, needle] of present) {
  const count = text.split(needle).length - 1
  console.log(`contains ${JSON.stringify(needle)} x${count}`)
  if (count === 0) {
    console.error(`  !! 缺 ${needle}`)
    failures += 1
  }
}

for (const [text, needle] of absent) {
  const count = text.split(needle).length - 1
  console.log(`absent ${JSON.stringify(needle)} x${count}`)
  if (count !== 0) {
    console.error(`  !! 应已移除却仍存在 ${needle}`)
    failures += 1
  }
}

process.exit(failures === 0 ? 0 : 1)
