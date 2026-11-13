/**
 * host 半冒烟：不启动 DSH，用 mock ctx 调 apply()，数 webServer.register 的调用次数。
 *
 * 用法：node .test/host-smoke.mjs [期望路由数]
 * 默认期望 17（AGENTS.md 的「13 条路由」基线 + 已归档/会话管理 4 条；/host/restart 复用同一 path）。
 */
const expected = Number(process.argv[2] ?? 17)

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
