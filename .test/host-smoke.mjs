/**
 * host 半冒烟：不启动 DSH，用 mock ctx 调 apply()，数 webServer.register 的调用次数。
 *
 * 用法：node .test/host-smoke.mjs [期望路由数]
 * 默认期望 20（2.1.0 起）。口径是「唯一 (kind, path) 行数」，同 path 的多方法被 defineRoutes 收敛成一行：
 * 技能 5（skills / skills·refresh / skill / skill·policy / open·dir）+ MCP 4 + 导入 2 + 根目录 1
 * + 会话管理 5 + 重启 1（GET+POST 同一 path）+ 插件 2（plugins / plugins·toggle）。
 */
const expected = Number(process.argv[2] ?? 20)

const { apply } = await import('../lib/index.js')

const registered = []
const services = {
  skills: {
    list: async () => [],
    get: async () => null,
  },
  connection: { requestRejection: () => undefined },
  webServer: {
    register(route) {
      registered.push(route)
      return () => {}
    },
  },
  workspaceRegistry: { archivedSessionIds: new Set() },
  sessionPersistence: { list: async () => [] },
}

const ctx = {
  inject(names, callback) {
    return callback(ctx)
  },
  effect(setup) {
    const dispose = setup()
    return () => dispose?.()
  },
  get(name) {
    return services[name]
  },
  // cordis 的事件总线：domain/changed 监听用；这里只验证注册不抛错。
  on() {
    return () => {}
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  ...services,
}

apply(ctx, { profile: 'desktop' })
await new Promise(resolve => setTimeout(resolve, 50))

const paths = registered.map(route => `${route.kind} ${route.path}`).sort()
console.log(`registered ${registered.length} route row(s)`)
for (const path of paths)
  console.log(`  ${path}`)

if (registered.length !== expected) {
  console.error(`\nEXPECTED ${expected} route row(s), got ${registered.length}`)
  process.exit(1)
}
console.log('\nOK')
