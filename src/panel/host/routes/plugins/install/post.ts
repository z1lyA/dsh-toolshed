import type { EventHandlerRequest } from 'dsh-tauri'
import type { ExtensionRouteDeps, PluginInstallBody, PluginInstallResponse } from '../../index.types'
import { defineEventHandler, dshRouteDepsOf, readBody } from 'dsh-tauri'
import { failure } from '../../failure'

/** spec 长度上限 512；理由见 `../inspect/post.ts`（同一个判据，两条路由各自独立挡住）。 */
const SPEC_MAX_LENGTH = 512

/**
 * 一次最多确认 64 个构建脚本。
 *
 * 真实的一次安装要批准的包是个位数；64 已经宽得离谱，超过它基本是把 lockfile 里的名字整段贴进来了。
 */
const APPROVED_BUILDS_MAX_COUNT = 64

/**
 * 逐项校验 `approvedBuilds`。
 *
 * 官方按名字授权，且**名字已经不在待批准里就整次拒绝**（`stale-approval`），所以混进一个空串或
 * 一个数字，用户得到的错离真正原因很远；在打给官方之前就挡成 400。
 */
function readApprovedBuilds(value: unknown): string[] | undefined | null {
  if (value === undefined)
    return undefined
  if (!Array.isArray(value) || value.length > APPROVED_BUILDS_MAX_COUNT)
    return null
  const builds: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '')
      return null
    builds.push(item)
  }
  return builds
}

/**
 * POST /api/plugins/install — 安装一个包（官方 `pluginManager.installBundle()` 的投影）。
 *
 * 三件必须说清的事：
 * 1. 官方**不抛异常**也会失败：`application:'failed'` 也是 200（业务结论），页面靠 `failureKind` /
 *    `errorCode` / `output` 如实说明；
 * 2. 需要批准构建脚本时这一轮**什么都没装**，回 `pendingBuilds`，用户点「允许并继续」后带
 *    `approvedBuilds` 再来一次；
 * 3. 我们**不**自己跑 pnpm、不自己写 package.json：全部交给官方服务，否则两套写盘逻辑会打架。
 */
export default defineEventHandler<EventHandlerRequest, Promise<PluginInstallResponse | { error: string, code?: string }>>(async (event) => {
  const deps = dshRouteDepsOf<ExtensionRouteDeps>(event)!
  const body = await readBody<PluginInstallBody>(event, { type: 'json' })
  const spec = typeof body?.spec === 'string' ? body.spec.trim() : ''
  if (spec === '' || spec.length > SPEC_MAX_LENGTH) {
    event.res.status = 400
    return { error: 'spec is required' }
  }
  const approvedBuilds = readApprovedBuilds(body?.approvedBuilds)
  if (approvedBuilds === null) {
    event.res.status = 400
    return { error: 'approvedBuilds must be an array of non-empty strings' }
  }
  // `registry` 给了就必须是非空字符串：空串会被官方当成「一个没名字的源」，报出来的错离原因很远。
  const registry = body?.registry
  if (registry !== undefined && (typeof registry !== 'string' || registry.trim() === '')) {
    event.res.status = 400
    return { error: 'registry must be a non-empty string' }
  }
  try {
    return await deps.plugins.install({
      spec,
      ...(approvedBuilds === undefined ? {} : { approvedBuilds }),
      ...(registry === undefined ? {} : { registry }),
    })
  }
  catch (error) {
    return failure(event, error)
  }
})
