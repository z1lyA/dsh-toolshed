import type { PluginBundleView, PluginUpdateCheckView } from '../apis/index.type'
import { describe, expect, it } from 'vitest'
import {
  isCheckStale,
  registryUpdatableOf,
  sortBundlesByUpdate,
  updateBadgeOf,
  updatedCountOf,
  updateTargetOf,
} from './plugins-tab.update'

function bundle(name: string, extra: Partial<PluginBundleView> = {}): PluginBundleView {
  return { name, official: false, installed: true, enabled: true, availability: 'profile', ...extra }
}

function listed(latest: string): PluginUpdateCheckView {
  return { name: 'x', status: 'listed', installed: '1.0.0', latest: { version: latest } }
}

describe('registryUpdatableOf', () => {
  it('只挑 update === registry 的包，去重并保持顺序', () => {
    const names = registryUpdatableOf([
      bundle('a', { update: 'registry' }),
      bundle('b'),
      bundle('c', { update: 'git' }),
      bundle('a', { update: 'registry' }),
    ])
    expect(names).toEqual(['a'])
  })

  it('link 依赖（没有 update 字段）永远不进检查清单', () => {
    expect(registryUpdatableOf([bundle('dsh-toolshed')])).toEqual([])
  })
})

describe('updateTargetOf / updateBadgeOf', () => {
  it('refused 或没有 latest 都不算有更新', () => {
    expect(updateTargetOf(undefined)).toBeUndefined()
    expect(updateTargetOf({ name: 'x', status: 'refused', problem: 'network' })).toBeUndefined()
    expect(updateTargetOf({ name: 'x', status: 'listed' })).toBeUndefined()
  })

  it('徽标用卡片上的当前版本拼「旧 → 新」；没有当前版本时只给目标版本', () => {
    expect(updateBadgeOf(bundle('x', { version: '0.6.4' }), listed('0.6.5'))).toEqual({ from: '0.6.4', to: '0.6.5' })
    expect(updateBadgeOf(bundle('x'), listed('0.6.5'))).toEqual({ to: '0.6.5' })
    expect(updateBadgeOf(bundle('x', { version: '0.6.4' }), undefined)).toBeUndefined()
  })
})

describe('sortBundlesByUpdate', () => {
  it('有更新的置顶，其余保持原有相对顺序（稳定）', () => {
    const bundles = [bundle('a'), bundle('b'), bundle('c'), bundle('d')]
    const checks = { c: listed('2.0.0'), d: listed('3.0.0') }
    expect(sortBundlesByUpdate(bundles, checks).map(item => item.name)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('一个都没有更新时原样返回（不制造新数组顺序差异）', () => {
    const bundles = [bundle('a'), bundle('b')]
    expect(sortBundlesByUpdate(bundles, {}).map(item => item.name)).toEqual(['a', 'b'])
  })
})

describe('isCheckStale', () => {
  const ttl = 10 * 60 * 1000

  it('没查过 / 超过 TTL 都算过期', () => {
    expect(isCheckStale(undefined, 1000, ttl)).toBe(true)
    expect(isCheckStale(0, ttl, ttl)).toBe(true)
    expect(isCheckStale(0, ttl - 1, ttl)).toBe(false)
  })

  it('时钟回拨当作过期（不要命中一份来自未来的缓存）', () => {
    expect(isCheckStale(2000, 1000, ttl)).toBe(true)
  })
})

describe('updatedCountOf', () => {
  it('只数这批要检查的包里确实有更新的', () => {
    const checks = { a: listed('2.0.0'), b: { name: 'b', status: 'refused', problem: 'network' } as PluginUpdateCheckView }
    expect(updatedCountOf(checks, ['a', 'b', 'c'])).toBe(1)
  })
})
