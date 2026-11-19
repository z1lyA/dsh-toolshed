/**
 * 插件**更新**能力的纯逻辑测试（`listVersions` / `updateBundle`）。
 *
 * 为什么值得单独一套：更新是这一页唯一「先卸后装」的操作，三件事必须钉住：
 *  - 候选版本要照官方口径筛（预发布 / 弃用 / 不兼容 / 非 bundle 一律不推），错一条就可能装上个起不来的版本；
 *  - 批量检查必须**串行且单个失败不中断**，否则一个包离线会让整页显示「没有更新」；
 *  - `restore` 必须透出——它表示「新版失败、旧版已装回」，页面要据此告诉用户版本没变。
 */
import type { PluginUpdaterService } from './plugins'
import { describe, expect, it } from 'vitest'
import {
  checkUpdates,
  resolvePluginUpdater,
  toUpdateCheckView,
  updateBundled,
  updateCandidateOf,
} from './plugins'

const LISTED = {
  status: 'listed',
  installed: '1.0.0',
  registry: 'https://registry.npmjs.org/',
  omitted: 2,
  versions: [
    { version: '1.2.0', publishedAt: '2026-11-01T00:00:00.000Z', bundle: true },
    { version: '1.1.0', bundle: true },
  ],
}

interface FakeUpdater {
  updater: PluginUpdaterService
  checked: string[]
  updates: Array<{ name: string, version: string, options: unknown }>
}

function fakeUpdater(
  answers: Record<string, unknown> | ((name: string) => unknown) = {},
  updateResult: unknown = { from: '1.0.0', to: '1.2.0', step: 'install', result: { changed: true, application: 'applied' } },
): FakeUpdater {
  const checked: string[] = []
  const updates: Array<{ name: string, version: string, options: unknown }> = []
  return {
    checked,
    updates,
    updater: {
      listVersions: async (name) => {
        checked.push(name)
        return typeof answers === 'function' ? answers(name) : answers[name]
      },
      updateBundle: async (name, version, options) => {
        updates.push({ name, version, options })
        return updateResult
      },
    },
  }
}

describe('updateCandidateOf（官方 updateCandidate 口径）', () => {
  it('取第一个「能装」的版本（官方已按新到旧排好）', () => {
    expect(updateCandidateOf(LISTED.versions)).toEqual({ version: '1.2.0', publishedAt: '2026-11-01T00:00:00.000Z' })
  })

  it('跳过预发布、弃用、不兼容、以及没有声明 bundle 的版本', () => {
    const versions = [
      { version: '2.0.0-beta.1', bundle: true, prerelease: true },
      { version: '1.9.0', bundle: true, deprecated: 'use 2.x' },
      { version: '1.8.0', bundle: true, incompatible: { name: 'x', version: '1.8.0', runtimeVersion: '0.2.0', requirements: {} } },
      { version: '1.7.0', bundle: false },
      { version: '1.6.0', bundle: true },
    ]
    expect(updateCandidateOf(versions)).toEqual({ version: '1.6.0' })
  })

  it('没有可用版本 / 形状不对时返回 undefined', () => {
    expect(updateCandidateOf([])).toBeUndefined()
    expect(updateCandidateOf(undefined)).toBeUndefined()
    expect(updateCandidateOf([null, { version: 42 }, { bundle: true }])).toBeUndefined()
  })
})

describe('toUpdateCheckView', () => {
  it('listed 带上 installed / registry / omitted 与候选版本', () => {
    expect(toUpdateCheckView('dsh-context', LISTED)).toEqual({
      name: 'dsh-context',
      status: 'listed',
      installed: '1.0.0',
      registry: 'https://registry.npmjs.org/',
      omitted: 2,
      latest: { version: '1.2.0', publishedAt: '2026-11-01T00:00:00.000Z' },
    })
  })

  it('listed 但没有可用候选 = 已是最新（不给 latest，也不当成失败）', () => {
    const view = toUpdateCheckView('dsh-context', { status: 'listed', installed: '1.2.0', versions: [] })
    expect(view.status).toBe('listed')
    expect(view).not.toHaveProperty('latest')
  })

  it('refused 把 problem / reason 原样带回；缺 problem 时给 unknown', () => {
    expect(toUpdateCheckView('x', { status: 'refused', problem: 'not-updatable', reason: 'link: dependency' }))
      .toEqual({ name: 'x', status: 'refused', problem: 'not-updatable', reason: 'link: dependency' })
    expect(toUpdateCheckView('x', null)).toEqual({ name: 'x', status: 'refused', problem: 'unknown' })
  })
})

describe('checkUpdates', () => {
  it('串行查、保持入参顺序、重复名字只查一次', async () => {
    const { updater, checked } = fakeUpdater({ 'a': LISTED, 'b': { status: 'refused', problem: 'not-found', reason: '404' } })
    const response = await checkUpdates(updater, ['a', 'b', 'a'])
    expect(checked).toEqual(['a', 'b'])
    expect(response.checks.map(check => check.name)).toEqual(['a', 'b'])
    expect(response.checks[1].problem).toBe('not-found')
  })

  it('单个包抛异常只把它记成 refused，不影响其它包', async () => {
    const { updater } = fakeUpdater((name) => {
      if (name === 'boom')
        throw new Error('registry down')
      return LISTED
    })
    const response = await checkUpdates(updater, ['boom', 'ok'])
    expect(response.checks[0]).toMatchObject({ name: 'boom', status: 'refused', problem: 'unknown', reason: 'registry down' })
    expect(response.checks[1]).toMatchObject({ name: 'ok', status: 'listed' })
  })
})

describe('updateBundled', () => {
  it('成功：ok 取 result.ok，并透出 from/to/step', async () => {
    const { updater, updates } = fakeUpdater({}, { from: '1.0.0', to: '1.1.0', step: 'install', result: { changed: true, application: 'applied' } })
    const response = await updateBundled(updater, { name: 'dsh-context', version: '1.1.0' })
    expect(response).toMatchObject({ ok: true, from: '1.0.0', to: '1.1.0', step: 'install' })
    expect(response.result?.application).toBe('applied')
    // 没给 registry 就不带 options：让官方按它自己的顺序重试
    expect(updates[0]).toEqual({ name: 'dsh-context', version: '1.1.0', options: undefined })
  })

  it('registry 透传给官方（必须从同一个源装，否则同版本号可能是别的构建）', async () => {
    const { updater, updates } = fakeUpdater()
    await updateBundled(updater, { name: 'dsh-context', version: '1.1.0', registry: 'https://example.test/' })
    expect(updates[0].options).toEqual({ registry: 'https://example.test/' })
  })

  it('失败且已回滚：ok 为假，但 restore 必须透出（页要说明版本没变）', async () => {
    const { updater } = fakeUpdater({}, {
      from: '1.0.0',
      to: '1.1.0',
      step: 'install',
      result: { changed: true, application: 'failed', error: { code: 'operation-error', diagnostic: 'EACCES' } },
      restore: { changed: true, application: 'applied' },
    })
    const response = await updateBundled(updater, { name: 'dsh-context', version: '1.1.0' })
    expect(response.ok).toBe(false)
    expect(response.result).toMatchObject({ ok: false, application: 'failed', errorCode: 'operation-error' })
    expect(response.restore).toMatchObject({ ok: true, application: 'applied' })
  })

  it('官方回形状不对的东西时不炸，ok 保持 false', async () => {
    // 用 null 而不是 undefined：undefined 会命中 `fakeUpdater` 的默认值。
    const { updater } = fakeUpdater({}, null)
    await expect(updateBundled(updater, { name: 'x', version: '1.0.0' })).resolves.toEqual({ ok: false })
  })
})

describe('resolvePluginUpdater', () => {
  it('两个方法都在才算可用（只有 listVersions 的老宿主不能更新）', () => {
    const both = { listVersions: async () => LISTED, updateBundle: async () => ({}) }
    expect(resolvePluginUpdater({ get: () => both } as never)).toBe(both)
    expect(resolvePluginUpdater({ get: () => ({ listVersions: async () => LISTED }) } as never)).toBeUndefined()
    expect(resolvePluginUpdater({ get: () => undefined } as never)).toBeUndefined()
  })

  it('拆卸期取服务抛错时当成不可用', () => {
    const ctx = { get: () => { throw new Error('disposed') } }
    expect(resolvePluginUpdater(ctx as never)).toBeUndefined()
  })
})
