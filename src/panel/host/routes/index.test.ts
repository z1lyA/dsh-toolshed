import type { HostRoute, RoutesContext } from 'dsh-tauri'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PanelExtensionHost } from '../types'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '.'
import { resetTestDshHome } from '../../../../.test/test-utils'
import { setCurrentHostInstance } from '../config/runtime'
import { createArchiveAdmin } from '../service/archive'
import { createPluginsAdmin } from '../service/plugins'
import { createRestartAdmin } from '../service/restart'

vi.mock('dsh-tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dsh-tauri')>()
  const { testDshHome: home } = await import('../../../../.test/test-utils')
  return { ...actual, DSH_HOME: home }
})

// 路由前缀随插件 id 走：/dsh-toolshed/api（原上游是 /api/desktop/dsh-tauri-panel-extension）
const P = '/dsh-toolshed/api'

const routeKey = (kind: string, path: string): string => `${kind}\u0000${path}`

const EXPECTED_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET', `${P}/skills`],
  ['POST', `${P}/skills/refresh`],
  ['GET', `${P}/skill`],
  ['POST', `${P}/skill`],
  ['DELETE', `${P}/skill`],
  ['POST', `${P}/skill/policy`],
  ['POST', `${P}/open/dir`],
  ['GET', `${P}/mcp`],
  ['POST', `${P}/mcp`],
  ['DELETE', `${P}/mcp`],
  ['POST', `${P}/mcp/toggle`],
  ['POST', `${P}/mcp/check`],
  ['POST', `${P}/mcp/copy`],
  ['GET', `${P}/import/scan`],
  ['POST', `${P}/import/apply`],
  ['GET', `${P}/roots`],
  ['POST', `${P}/roots`],
  ['DELETE', `${P}/roots`],
  ['GET', `${P}/archived`],
  ['POST', `${P}/archive/plan`],
  ['DELETE', `${P}/archive`],
  ['POST', `${P}/archive/unarchive`],
  ['POST', `${P}/archive/pending/cancel`],
  ['GET', `${P}/host/restart`],
  ['POST', `${P}/host/restart`],
  ['GET', `${P}/plugins`],
  ['POST', `${P}/plugins/bundle/toggle`],
]

/** 同一路径的多个方法由 defineRoutes 收敛为一行注册。 */
const EXPECTED_PATHS: readonly string[] = [...new Set(EXPECTED_ROUTES.map(([, path]) => path))]

const ALLOW_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

function allowFor(path: string): string {
  const methods = new Set(EXPECTED_ROUTES.filter(([, candidate]) => candidate === path).map(([method]) => method))
  if (methods.has('GET'))
    methods.add('HEAD')
  return ALLOW_ORDER.filter(method => method === 'OPTIONS' || methods.has(method)).join(', ')
}

/** 所有路径都未声明 PATCH，用于统一验证 405 + allow。 */
const UNDECLARED_METHOD = 'PATCH'

const SKILL = {
  name: 'demo-skill',
  description: 'A demo skill',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'user-dsh',
  provider: 'filesystem',
}

/**
 * 假 pluginManager：字段形状照官方 `BundleInfo`（一个第三方包 + 一个官方包），
 * 并记下每次启停的入参，用来断言「409 拒绝时没有真的去写」。
 *
 * 只实现 `listBundles` / `setBundleEnabled`：服务层鸭子类型只认这两个（老宿主的条目级方法不再需要）。
 */
function pluginManagerStub(): {
  pluginManager: unknown
  bundleCalls: Array<{ name: string, enabled: boolean }>
} {
  const bundleCalls: Array<{ name: string, enabled: boolean }> = []
  // 故意把官方包排在前面：排序在宿主做，响应里必须变成「第三方在前」。
  const bundles = [
    {
      name: '@deepseek-ai/dsh-hmr',
      official: true,
      installed: true,
      enabled: true,
      availability: 'installation',
    },
    {
      name: 'dsh-toolshed',
      official: false,
      installed: true,
      enabled: true,
      availability: 'profile',
      version: '2.3.0',
      meta: {
        title: { en: 'Dsh Toolshed', zh: '工具箱' },
        description: { en: 'Panel tweaks', zh: '面板增强' },
        icon: 'data:image/png;base64,AAAA',
      },
      description: 'toolshed manifest description',
    },
  ]
  return {
    bundleCalls,
    pluginManager: {
      listBundles: async () => bundles,
      setBundleEnabled: async (name: string, enabled: boolean) => {
        bundleCalls.push({ name, enabled })
        // 包级可能回「需重启」：200 透出 application 才让页面能如实提示。
        return { changed: true, application: 'restart-required', stage: 'enable', target: name, enabled }
      },
    },
  }
}

interface Harness {
  ctx: unknown
  registered: Map<string, HostRoute>
  dir: string
}

function createHarness(services: Record<string, unknown> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-panel-extension-'))
  const registered = new Map<string, HostRoute>()
  return {
    dir,
    registered,
    ctx: {
      webServer: {
        register(route: HostRoute): () => void {
          const key = routeKey(route.kind, route.path)
          if (registered.has(key))
            throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
          registered.set(key, route)
          return () => {
            registered.delete(key)
          }
        },
      },
      logger: { error: () => {} },
      skills: {
        list: async () => [SKILL],
        get: async (name: string) => (name === SKILL.name
          ? { name, content: '# demo', path: join(dir, 'skills', name, 'SKILL.md') }
          : undefined),
      },
      // 默认**不带** pluginManager：正好像真机上的老 DSH 那样，让「服务缺失 → 503」被现成的 start() 覆盖。
      ...services,
    },
  }
}

function mount(harness: Harness): () => void {
  setCurrentHostInstance(harness.ctx as unknown as PanelExtensionHost)
  // 会话管理 / 重启 / 插件启停的实例按 harness 的临时 home 建：真正的服务（workspaceRegistry、
  // pluginManager 等）默认不在 mock ctx 里，正好用来验证「服务缺失时返回 503 而不是抛错」。
  const config = { dshHome: harness.dir }
  return routes(harness.ctx as RoutesContext, {
    profileDirPath: join(harness.dir, 'profiles', 'web'),
    remountProvider: async () => {},
    archive: createArchiveAdmin(harness.ctx as never, config),
    restart: createRestartAdmin(harness.ctx as never, config),
    plugins: createPluginsAdmin(harness.ctx as never),
  })
}

const servers: Server[] = []
const dirs: string[] = []

async function listen(registered: Map<string, HostRoute>): Promise<string> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = registered.get(routeKey('exact', pathname))
    if (!route) {
      response.writeHead(404)
      response.end()
      return
    }
    Promise.resolve(route.handler(request, response)).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500)
        response.end()
      }
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function start(services: Record<string, unknown> = {}): Promise<{ base: string, dispose: () => void }> {
  const harness = createHarness(services)
  dirs.push(harness.dir)
  const dispose = mount(harness)
  const base = await listen(harness.registered)
  return { base, dispose }
}

beforeEach(() => {
  resetTestDshHome()
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('能力管理器路由声明', () => {
  it('按资源化的路径与方法声明 exact 路由，卸载后清空注册', () => {
    const harness = createHarness()
    dirs.push(harness.dir)
    const dispose = mount(harness)

    expect([...harness.registered.keys()].sort())
      .toEqual(EXPECTED_PATHS.map(path => routeKey('exact', path)).sort())
    expect(harness.registered.size).toBe(EXPECTED_PATHS.length)

    dispose()
    expect(harness.registered.size).toBe(0)
  })

  it('gET /archived 在 workspaceRegistry 缺失时返回 503 而不是抛错', async () => {
    const { base, dispose } = await start()

    const response = await fetch(`${base}${P}/archived`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'the workspace registry is not mounted',
      code: 'registry-unavailable',
    })

    dispose()
  })

  it('gET /host/restart 在非桌面宿主下如实返回不可用（不触达进程控制）', async () => {
    const { base, dispose } = await start()

    const response = await fetch(`${base}${P}/host/restart`)
    expect(response.status).toBe(200)
    const body = await response.json() as { restartAvailable: boolean, blockers: unknown[], logFile?: string }
    expect(body.restartAvailable).toBe(false)
    expect(body.blockers).toEqual([])
    expect(typeof body.logFile).toBe('string')

    dispose()
  })

  it('未声明的方法拒绝访问（405 + allow 头）', async () => {
    const { base, dispose } = await start()

    for (const path of EXPECTED_PATHS) {
      const response = await fetch(`${base}${path}`, { method: UNDECLARED_METHOD })
      expect(response.status, path).toBe(405)
      expect(response.headers.get('allow'), path).toBe(allowFor(path))
    }

    dispose()
  })

  it('oPTIONS 预检返回 204 并带 allow 头', async () => {
    const { base, dispose } = await start()

    const read = await fetch(`${base}${P}/mcp`, { method: 'OPTIONS' })
    expect(read.status).toBe(204)
    expect(read.headers.get('allow')).toBe('GET, HEAD, POST, DELETE, OPTIONS')

    const mutate = await fetch(`${base}${P}/mcp/toggle`, { method: 'OPTIONS' })
    expect(mutate.status).toBe(204)
    expect(mutate.headers.get('allow')).toBe('POST, OPTIONS')

    dispose()
  })

  it('gET /skills 返回宿主技能目录行（含编辑标志，不带 resourceBase 即不可编辑）', async () => {
    const { base, dispose } = await start()

    const response = await fetch(`${base}${P}/skills`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      skills: [{
        name: 'demo-skill',
        description: 'A demo skill',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user-dsh',
        provider: 'filesystem',
        editable: false,
        removable: true,
        policyEditable: false,
      }],
    })

    dispose()
  })

  it('gET /skill 命中返回内容，未命中返回 404 领域错误', async () => {
    const { base, dispose } = await start()

    const found = await fetch(`${base}${P}/skill?name=demo-skill`)
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ name: 'demo-skill', content: '# demo' })

    const missing = await fetch(`${base}${P}/skill?name=nope`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'skill not found' })

    dispose()
  })

  it('gET /mcp 在空的 patch 层上返回空列表（只读响应不带 restartNeeded）', async () => {
    const { base, dispose } = await start()

    const response = await fetch(`${base}${P}/mcp`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ servers: [] })

    dispose()
  })

  it('pOST 变更路由对缺失字段返回 400 领域错误', async () => {
    const { base, dispose } = await start()

    const cases: ReadonlyArray<readonly [string, string, Record<string, unknown>, string]> = [
      ['POST', `${P}/mcp/toggle`, {}, 'id and disabled are required'],
      ['DELETE', `${P}/mcp`, {}, 'id is required'],
      ['POST', `${P}/mcp/check`, {}, 'id is required'],
      ['POST', `${P}/mcp/copy`, {}, 'id is required'],
      ['DELETE', `${P}/roots`, {}, 'id is required'],
      ['POST', `${P}/roots`, { kind: 'zip' }, 'kind must be local or git'],
      ['POST', `${P}/open/dir`, {}, 'target is required'],
      ['POST', `${P}/plugins/bundle/toggle`, {}, 'name and enabled are required'],
    ]
    for (const [method, path, body, error] of cases) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status, path).toBe(400)
      expect(await response.json(), path).toEqual({ error })
    }

    dispose()
  })

  it('非对象 / 非法 JSON / 非 JSON 编码体在变更路由上返回 400', async () => {
    const { base, dispose } = await start()

    const invalidJson = await fetch(`${base}${P}/mcp/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(invalidJson.status).toBe(400)

    const urlencoded = await fetch(`${base}${P}/mcp/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=x&disabled=true',
    })
    expect(urlencoded.status).toBe(400)

    dispose()
  })

  it('pOST /host/restart 不再额外要求 Origin 同源（桌面代理常不带 Origin），边界由框架闸门承担', async () => {
    const { base, dispose } = await start()

    // 没有 Origin、或经代理带了转发头：都应该到达 handler（这里是「非桌面宿主」→ 503），
    // 而不是被手写判据 403 掉——2.0.1 修的就是这个「按钮永远点不动」。
    const noOrigin = await fetch(`${base}${P}/host/restart`, { method: 'POST' })
    expect(noOrigin.status).toBe(503)
    expect(await noOrigin.json()).toMatchObject({ code: 'restart-unavailable' })

    const forwarded = await fetch(`${base}${P}/host/restart`, {
      method: 'POST',
      headers: { 'origin': base, 'x-forwarded-for': '127.0.0.1' },
    })
    expect(forwarded.status).toBe(503)
    expect(await forwarded.json()).toMatchObject({ code: 'restart-unavailable' })

    // 跨源请求仍由框架闸门挡下（这条边界没有因为删掉手写判据而变松）。
    const crossOrigin = await fetch(`${base}${P}/host/restart`, {
      method: 'POST',
      headers: { 'origin': 'http://evil.example' },
    })
    expect(crossOrigin.status).toBe(403)
    expect(await crossOrigin.json()).toEqual({ error: 'cross-origin-request' })

    dispose()
  })

  it('gET /plugins 只给 bundles（第三方在前），响应里没有 plugins / rows', async () => {
    const { pluginManager } = pluginManagerStub()
    const { base, dispose } = await start({ pluginManager })

    const listed = await fetch(`${base}${P}/plugins`)
    expect(listed.status).toBe(200)
    const body = await listed.json() as { bundles: Array<Record<string, unknown>> }

    // 这个 tab 只讲包：顶层只有 bundles，包里没有行级字段。
    expect(Object.keys(body)).toEqual(['bundles'])
    expect(body).not.toHaveProperty('plugins')
    expect(body.bundles).toEqual([
      {
        name: 'dsh-toolshed',
        official: false,
        installed: true,
        enabled: true,
        availability: 'profile',
        version: '2.3.0',
        title: { en: 'Dsh Toolshed', zh: '工具箱' },
        description: { en: 'Panel tweaks', zh: '面板增强' },
        icon: 'data:image/png;base64,AAAA',
        manifestDescription: 'toolshed manifest description',
      },
      {
        name: '@deepseek-ai/dsh-hmr',
        official: true,
        installed: true,
        enabled: true,
        availability: 'installation',
      },
    ])
    for (const bundle of body.bundles)
      expect(bundle).not.toHaveProperty('rows')

    dispose()
  })

  it('pOST /plugins/bundle/toggle 走官方 setBundleEnabled（200 透出 application，不改口径）', async () => {
    const { pluginManager, bundleCalls } = pluginManagerStub()
    const { base, dispose } = await start({ pluginManager })

    const toggled = await fetch(`${base}${P}/plugins/bundle/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '@deepseek-ai/dsh-hmr', enabled: false }),
    })
    expect(toggled.status).toBe(200)
    // 「需重启」也是成功：页面据此提示，而不是当成失败。
    expect(await toggled.json()).toEqual({ ok: true, application: 'restart-required', changed: true })
    expect(bundleCalls).toEqual([{ name: '@deepseek-ai/dsh-hmr', enabled: false }])

    dispose()
  })

  it('pOST /plugins/bundle/toggle 拒绝停用 dsh-toolshed 包（409 self-management，且没有真的去写）', async () => {
    const { pluginManager, bundleCalls } = pluginManagerStub()
    const { base, dispose } = await start({ pluginManager })

    const response = await fetch(`${base}${P}/plugins/bundle/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dsh-toolshed', enabled: false }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'self-management' })
    expect(bundleCalls).toEqual([])

    dispose()
  })

  it('gET /plugins 在 pluginManager 缺失时返回 503 而不是 200 空列表', async () => {
    const { base, dispose } = await start()

    const response = await fetch(`${base}${P}/plugins`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'the pluginManager service is not mounted in this dsh build',
      code: 'plugin-manager-unavailable',
    })

    // 包级启停同样 503：老宿主没有 setBundleEnabled，不能让它抛 is not a function 变 500。
    const bundleToggle = await fetch(`${base}${P}/plugins/bundle/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'some-bundle', enabled: true }),
    })
    expect(bundleToggle.status).toBe(503)
    expect(await bundleToggle.json()).toMatchObject({ code: 'plugin-manager-unavailable' })

    dispose()
  })

  it('同一份声明两次注册下各读各的 deps（两次注册互不串台）', async () => {
    const first = createHarness()
    const second = createHarness()
    dirs.push(first.dir, second.dir)
    const disposeFirst = mount(first)
    const disposeSecond = mount(second)
    mkdirSync(join(first.dir, 'profiles', 'web'), { recursive: true })
    mkdirSync(join(second.dir, 'profiles', 'web'), { recursive: true })
    const firstBase = await listen(first.registered)
    const secondBase = await listen(second.registered)

    const saved = await fetch(`${firstBase}${P}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverName: 'only-first', transport: 'http', url: 'http://127.0.0.1:9/mcp' }),
    })
    expect(saved.status).toBe(200)

    const firstRows = await (await fetch(`${firstBase}${P}/mcp`)).json() as { servers: unknown[] }
    expect(firstRows.servers).toHaveLength(1)

    const secondRows = await (await fetch(`${secondBase}${P}/mcp`)).json() as { servers: unknown[] }
    expect(secondRows.servers).toEqual([])

    disposeFirst()
    disposeSecond()
  })
})
