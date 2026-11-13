import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HostRoute } from 'dsh-tauri'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join as nodeJoin } from 'node:path'
import { join } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../apply'

/**
 * 会话管理路由的 HTTP 级集成测试：`apply()` → 真实 `defineRoutes`/h3 → 真实文件系统。
 *
 * 为什么需要它（服务层单测已经覆盖，而真机验收要等重启 DSH）：
 *   - 验证 `apply` 里的依赖装配真的接通了（deps.archive / deps.restart、`ctx.inject` 嵌套、启动清扫 effect）；
 *   - 验证 HTTP 层语义：闸门（405 / 跨源 403）、错误码 → 状态码、DELETE 带 body；
 *   - 验证**删除真的落盘**：日志目录与投影缓存被删，live 会话只入队，队列可取消。
 *
 * 所有文件都在 `mkdtemp` 出来的临时 DSH home 里，绝不碰真实 `~/.dsh`。
 */

interface FakeWorld {
  home: string
  archived: Set<string>
  live: Set<string>
  workspaces: Array<{ id: string, title: string, sessionIds: string[] }>
  routes: Map<string, HostRoute>
  disposers: Array<() => void>
}

const servers: Server[] = []
const dirs: string[] = []

function writeSessionLog(home: string, project: string, id: string, bytes = 512): string {
  const dir = join(home, 'sessions', project, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v3.jsonl.zstd'), Buffer.alloc(bytes, 7))
  return dir
}

function writeProjectionCache(home: string, id: string): string {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.json`)
  writeFileSync(file, '{"v":1}')
  return file
}

function createWorld(): FakeWorld {
  const home = mkdtempSync(join(tmpdir(), 'dsh-mcp-studio-sessions-'))
  dirs.push(home)
  writeFileSync(join(home, 'keep.txt'), 'untouched')
  return {
    home,
    archived: new Set<string>(),
    live: new Set<string>(),
    workspaces: [],
    routes: new Map(),
    disposers: [],
  }
}

/** 只实现插件真正用到的宿主面；registry 的三个写方法真的改集合，好断言副作用。 */
function createCtx(world: FakeWorld): Record<string, unknown> {
  const ctx: any = {
    webServer: {
      register(route: HostRoute): () => void {
        const key = `${route.kind}\u0000${route.path}`
        if (world.routes.has(key))
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        world.routes.set(key, route)
        return () => world.routes.delete(key)
      },
    },
    connection: { requestRejection: () => undefined },
    skills: { list: async () => [], get: async () => null },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    workspaceRegistry: {
      get archivedSessionIds(): Set<string> {
        return world.archived
      },
      list: () => world.workspaces,
      archiveSession: async (id: string) => {
        world.archived.add(id)
      },
      unarchiveSession: async (id: string) => {
        world.archived.delete(id)
      },
      unpinSession: async () => {},
    },
    sessionPersistence: { list: async () => [] },
    sessions: {
      get: (id: string) => (world.live.has(id) ? { header: { id } } : undefined),
      list: () => [],
    },
    sessionQuery: { listEvents: async () => [] },
    schedule: { catalog: async () => [], delete: async () => {} },
    // 不提供 storageDomain：走「按精确文件删投影缓存」的兜底分支
    inject(_names: string[], callback: (ctx: any) => unknown) {
      const dispose = callback(ctx)
      if (typeof dispose === 'function')
        world.disposers.push(dispose as () => void)
      return dispose
    },
    effect(setup: () => (() => void) | void) {
      const dispose = setup()
      if (typeof dispose === 'function')
        world.disposers.push(dispose)
      return dispose
    },
    get(name: string) {
      return ctx[name]
    },
    on() {
      return () => {}
    },
  }
  return ctx
}

async function start(world: FakeWorld): Promise<string> {
  const ctx = createCtx(world)
  apply(ctx as never, { profile: 'desktop', dshHome: world.home } as never)
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = world.routes.get(`exact\u0000${pathname}`)
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

const P = '/dsh-mcp-studio/api'

function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('会话管理路由（HTTP 级）', () => {
  it('apply 注册了全部新路径，闸门照旧：跨源 DELETE 403、未声明方法 405', async () => {
    const world = createWorld()
    const base = await start(world)

    for (const path of ['archived', 'archive/plan', 'archive/unarchive', 'archive/pending/cancel', 'host/restart'])
      expect(world.routes.has(`exact\u0000${P}/${path}`), path).toBe(true)
    expect(world.routes.has(`exact\u0000${P}/archive`)).toBe(true)

    const crossOrigin = await fetch(`${base}${P}/archive`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'origin': 'http://evil.example' },
      body: JSON.stringify({ ids: ['session-x'] }),
    })
    expect(crossOrigin.status).toBe(403)
    expect(await crossOrigin.json()).toEqual({ error: 'cross-origin-request' })

    const patch = await fetch(`${base}${P}/archived`, { method: 'PATCH' })
    expect(patch.status).toBe(405)

    for (const dispose of world.disposers.splice(0))
      dispose()
  })

  it('列表 → 计划 → 取消归档 → 删除（live 只入队、可取消），非归档 id 被拒绝', async () => {
    const world = createWorld()
    const persistentId = 'session-aaaa-1111'
    const liveId = 'session-bbbb-2222'
    world.archived.add(persistentId)
    world.archived.add(liveId)
    world.live.add(liveId)
    world.workspaces.push({ id: 'ws-1', title: 'CodeProject', sessionIds: [persistentId, liveId] })

    const persistentLog = writeSessionLog(world.home, 'proj', persistentId, 1024)
    const liveLog = writeSessionLog(world.home, 'proj', liveId, 256)
    writeProjectionCache(world.home, persistentId)
    const liveCache = writeProjectionCache(world.home, liveId)
    const base = await start(world)

    const listed = await (await fetch(`${base}${P}/archived`)).json() as any
    expect(listed.items.map((item: any) => item.id).sort()).toEqual([persistentId, liveId])
    const persistentRow = listed.items.find((item: any) => item.id === persistentId)
    expect(persistentRow).toMatchObject({ hasLog: true, logFiles: 1, workspaceTitle: 'CodeProject', live: false })
    expect(persistentRow.logBytes).toBeGreaterThanOrEqual(1024)
    expect(listed.totals).toMatchObject({ count: 2, pending: 0 })

    const plan = await (await fetch(`${base}${P}/archive/plan`, jsonBody({ ids: [persistentId, liveId] }))).json() as any
    expect(plan.totals).toMatchObject({ count: 2, immediate: 1, queued: 1 })
    expect(plan.items.find((item: any) => item.id === liveId)).toMatchObject({ ok: true, live: true, willQueue: true })

    // 取消归档：注册表集合被改，列表少一条
    const unarchive = await (await fetch(`${base}${P}/archive/unarchive`, jsonBody({ ids: [persistentId] }))).json() as any
    expect(unarchive.totals.unarchived).toBe(1)
    expect(world.archived.has(persistentId)).toBe(false)
    const afterUnarchive = await (await fetch(`${base}${P}/archived`)).json() as any
    expect(afterUnarchive.items.map((item: any) => item.id)).toEqual([liveId])

    // 已取消归档的 id 不能再删（日志原样保留）
    const rejected = await fetch(`${base}${P}/archive`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [persistentId] }),
    })
    expect(rejected.status).toBe(200)
    expect((await rejected.json() as any).results[0]).toMatchObject({ deleted: false, code: 'not-archived' })
    expect(existsSync(persistentLog)).toBe(true)

    // live 会话：只入队，不碰文件
    const queued = await (await fetch(`${base}${P}/archive`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [liveId], cleanupAttachments: false }),
    })).json() as any
    expect(queued.totals).toMatchObject({ deleted: 0, queued: 1 })
    expect(queued.results[0]).toMatchObject({ deleted: false, queued: true })
    expect(existsSync(liveLog)).toBe(true)
    expect(existsSync(liveCache)).toBe(true)
    const queueFile = join(world.home, 'session-admin', 'pending-deletions.json')
    expect((JSON.parse(readFileSync(queueFile, 'utf8')) as any).entries).toHaveLength(1)

    // 取消排队：队列清空，文件依旧在
    const cancelled = await (await fetch(`${base}${P}/archive/pending/cancel`, jsonBody({ ids: [liveId] }))).json() as any
    expect(cancelled.totals.cancelled).toBe(1)
    expect((JSON.parse(readFileSync(queueFile, 'utf8')) as any).entries).toHaveLength(0)
    expect(existsSync(liveLog)).toBe(true)

    for (const dispose of world.disposers.splice(0))
      dispose()
  })

  it('非 live 的归档会话被真正删除：日志目录 + 投影缓存消失，并释放字节数', async () => {
    const world = createWorld()
    const id = 'session-cccc-3333'
    world.archived.add(id)
    const log = writeSessionLog(world.home, 'proj', id, 2048)
    const cache = writeProjectionCache(world.home, id)
    const base = await start(world)

    const body = await (await fetch(`${base}${P}/archive`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id], cleanupAttachments: false }),
    })).json() as any

    expect(body.totals.deleted).toBe(1)
    expect(body.totals.freedBytes).toBeGreaterThanOrEqual(2048)
    expect(body.results[0]).toMatchObject({ id, deleted: true })
    expect(existsSync(log)).toBe(false)
    expect(existsSync(cache)).toBe(false)
    // 归档记录也被清理 → 列表为空
    expect((await (await fetch(`${base}${P}/archived`)).json() as any).items).toEqual([])

    for (const dispose of world.disposers.splice(0))
      dispose()
  })

  it('启动清扫：预置队列在 apply 后被执行（日志目录消失、队列清空）', async () => {
    const world = createWorld()
    const id = 'session-dddd-4444'
    world.archived.add(id)
    const log = writeSessionLog(world.home, 'proj', id, 128)
    const queueDir = join(world.home, 'session-admin')
    mkdirSync(queueDir, { recursive: true })
    writeFileSync(join(queueDir, 'pending-deletions.json'), JSON.stringify({
      version: 1,
      entries: [{ id, requestedAt: new Date().toISOString(), cleanupAttachments: false, attempts: 0, lastError: null, lastAttemptAt: null }],
    }))

    await start(world)
    // apply 里的清扫是 setTimeout(500) 的，等它跑完
    await vi.waitFor(() => {
      expect(existsSync(log)).toBe(false)
    }, { timeout: 3000, interval: 100 })

    const queue = JSON.parse(readFileSync(join(queueDir, 'pending-deletions.json'), 'utf8')) as any
    expect(queue.entries).toEqual([])

    for (const dispose of world.disposers.splice(0))
      dispose()
  })

  it('服务页状态：非桌面宿主返回可用性判定与日志路径，且不落重启计划', async () => {
    const world = createWorld()
    const base = await start(world)

    const status = await (await fetch(`${base}${P}/host/restart`)).json() as any
    expect(status.restartAvailable).toBe(false)
    expect(status.blockers).toEqual([])
    expect(status.reason).toBe('not-desktop-host')
    expect(status.logFile).toBe(nodeJoin(world.home, 'session-admin', 'restart.log'))

    // 非桌面宿主下执行重启必须被拒绝，且不能产生重启计划文件
    const attempt = await fetch(`${base}${P}/host/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': base },
    })
    expect(attempt.status).toBe(503)
    expect(await attempt.json()).toMatchObject({ code: 'restart-unavailable' })
    expect(existsSync(join(world.home, 'session-admin', 'restart-plan.json'))).toBe(false)

    for (const dispose of world.disposers.splice(0))
      dispose()
  })
})
