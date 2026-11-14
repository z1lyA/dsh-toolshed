/**
 * 插件启停的纯逻辑规格测试。
 *
 * 为什么脱离 DSH 测：官方包不装成依赖（AGENTS 约束 4），`pluginManager` 只能鸭子类型化；
 * 投影与判定写成纯函数就是为了在这里用假 manager 把最容易回归的行为钉住：
 *
 *  - 官方 `application:'failed'` **不抛异常**——只 try/catch 会把失败当成功，页面于是显示「已启用」；
 *  - 停用 dsh-toolshed 自己必须被硬拒绝——否则面板当场消失、用户没有恢复入口；
 *  - 服务缺失必须是可识别的机器码（503）——否则整页 500，或更糟：200 + 空列表被误读成「一个插件都没装」；
 *  - 包级投影的排序 / 丢弃规则——照官方 `BundleInfo` 的形状搬字段，官方漂移时要降级而不是 500。
 */
import type { OfficialBundleInfo, OfficialChangeResult, PluginManagerService } from './plugins'
import { describe, expect, it } from 'vitest'
import {
  createPluginsAdmin,
  listPluginBundles,
  PluginRequestError,
  resolvePluginManager,
  toggleBundle,
} from './plugins'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

interface FakeManager {
  manager: PluginManagerService
  /** 每次 `setBundleEnabled` 的入参：用来断言「拒绝时没有真的去写」。 */
  calls: Array<{ name: string, enabled: boolean }>
}

function fakeManager(
  bundles: OfficialBundleInfo[] = [],
  result?: OfficialChangeResult,
): FakeManager {
  const calls: Array<{ name: string, enabled: boolean }> = []
  return {
    calls,
    manager: {
      listBundles: async () => bundles,
      setBundleEnabled: async (name, enabled) => {
        calls.push({ name, enabled })
        return result ?? { changed: true, application: 'applied' }
      },
    },
  }
}

const TOOLSHED_BUNDLE: OfficialBundleInfo = {
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
    // 官方在 meta 里也放一份加载失败文案；不透出它（机器码走 error.code）。
    error: 'boom',
  },
  description: 'manifest description (not localized)',
}

describe('listPluginBundles（官方包 → 线协议包）', () => {
  it('包字段原样透传，meta 里只有 title / description / icon 三件套', async () => {
    const { manager } = fakeManager([TOOLSHED_BUNDLE])

    expect(await listPluginBundles(manager)).toEqual([{
      name: 'dsh-toolshed',
      official: false,
      installed: true,
      enabled: true,
      availability: 'profile',
      version: '2.3.0',
      title: { en: 'Dsh Toolshed', zh: '工具箱' },
      description: { en: 'Panel tweaks', zh: '面板增强' },
      icon: 'data:image/png;base64,AAAA',
      manifestDescription: 'manifest description (not localized)',
    }])
  })

  it('meta.error 丢掉、manifest 原文落在 manifestDescription（不与本地化 description 混用）', async () => {
    const { manager } = fakeManager([TOOLSHED_BUNDLE])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle.manifestDescription).toBe('manifest description (not localized)')
    expect(bundle.description).toEqual({ en: 'Panel tweaks', zh: '面板增强' })
    expect(JSON.stringify(bundle)).not.toContain('boom')
  })

  it('包形状里没有 rows / plugins：这个 tab 只讲包', async () => {
    const { manager } = fakeManager([TOOLSHED_BUNDLE])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle).not.toHaveProperty('rows')
    expect(bundle).not.toHaveProperty('plugins')
  })

  it('readOnlyReason / error.code 原样透出（不翻译、不收窄取值）', async () => {
    const { manager } = fakeManager([{
      ...TOOLSHED_BUNDLE,
      name: 'protected',
      readOnlyReason: 'some-future-code',
      error: { code: 'load-failed' },
    }])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle.readOnlyReason).toBe('some-future-code')
    expect(bundle.errorCode).toBe('load-failed')
  })

  it('icon 超过 64 KiB 被丢弃，恰好 64 KiB 仍透传（二十多个包全带上会撑到几 MB）', async () => {
    const limit = 64 * 1024
    const { manager } = fakeManager([
      { ...TOOLSHED_BUNDLE, name: 'huge-icon', meta: { ...TOOLSHED_BUNDLE.meta, icon: 'x'.repeat(limit + 1) } },
      { ...TOOLSHED_BUNDLE, name: 'exact-icon', meta: { ...TOOLSHED_BUNDLE.meta, icon: 'y'.repeat(limit) } },
    ])

    const bundles = await listPluginBundles(manager)
    const huge = bundles.find(bundle => bundle.name === 'huge-icon')
    const exact = bundles.find(bundle => bundle.name === 'exact-icon')
    expect(huge?.icon).toBeUndefined()
    expect(exact?.icon).toHaveLength(limit)
  })

  it('第三方在前、官方在后，各自按包名升序', async () => {
    const { manager } = fakeManager([
      { ...TOOLSHED_BUNDLE, name: 'aaa-official', official: true },
      { ...TOOLSHED_BUNDLE, name: 'zzz-third-party' },
      { ...TOOLSHED_BUNDLE, name: 'mmm-official', official: true },
      { ...TOOLSHED_BUNDLE, name: 'bbb-third-party' },
    ])

    expect((await listPluginBundles(manager)).map(bundle => bundle.name))
      .toEqual(['bbb-third-party', 'zzz-third-party', 'aaa-official', 'mmm-official'])
  })

  it('形状不对的包被跳过：一条坏数据不该让整页 500', async () => {
    const { manager } = fakeManager([
      null as unknown as OfficialBundleInfo,
      { name: 42 } as unknown as OfficialBundleInfo,
      { name: '' } as unknown as OfficialBundleInfo,
      // availability 是页面的状态判据，缺了就无法如实展示，宁可整包不出现。
      { name: 'no-availability', official: false } as unknown as OfficialBundleInfo,
      TOOLSHED_BUNDLE,
    ])

    const bundles = await listPluginBundles(manager)
    expect(bundles).toHaveLength(1)
    expect(bundles[0].name).toBe('dsh-toolshed')
  })

  it('官方回非数组时给空清单而不是抛错', async () => {
    const manager = {
      listBundles: async () => undefined as unknown as OfficialBundleInfo[],
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
    }

    expect(await listPluginBundles(manager)).toEqual([])
  })
})

describe('toggleBundle：application 原样透出，只判 ok', () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['applied', true],
    ['restart-required', true],
    ['overridden', true],
    ['failed', false],
    ['cancelled', false],
  ]

  for (const [application, ok] of cases) {
    it(`${application} → ok:${ok}`, async () => {
      const { manager, calls } = fakeManager([], { changed: true, application })

      const response = await toggleBundle(manager, 'some-bundle', false)
      expect(response).toEqual({ ok, application, changed: true })
      expect(calls).toEqual([{ name: 'some-bundle', enabled: false }])
    })
  }

  it('failed 不抛异常，如实透出 errorCode 与 diagnostic（此时文件可能已经写了）', async () => {
    const { manager } = fakeManager([], {
      changed: true,
      application: 'failed',
      error: { code: 'bundle-in-use', diagnostic: 'a live fiber is using this bundle' },
    })

    const response = await toggleBundle(manager, 'some-bundle', true)
    expect(response).toEqual({
      ok: false,
      application: 'failed',
      changed: true,
      errorCode: 'bundle-in-use',
      diagnostic: 'a live fiber is using this bundle',
    })
  })

  it('readOnlyReason 包不预先拒绝：官方自己的 management-required 原样回到页面', async () => {
    const { manager, calls } = fakeManager([], {
      changed: false,
      application: 'failed',
      error: { code: 'management-required' },
    })

    const response = await toggleBundle(manager, 'protected', false)
    expect(response).toEqual({ ok: false, application: 'failed', changed: false, errorCode: 'management-required' })
    expect(calls).toHaveLength(1)
  })
})

describe('toggleBundle：硬拒绝停用本面板自己', () => {
  it('停用 dsh-toolshed → self-management，且没有真的去写 profile 组合', async () => {
    const { manager, calls } = fakeManager()

    await expect(toggleBundle(manager, 'dsh-toolshed', false)).rejects.toBeInstanceOf(PluginRequestError)
    await expect(toggleBundle(manager, 'dsh-toolshed', false)).rejects.toMatchObject({ code: PLUGIN_SELF_MANAGEMENT })
    expect(calls).toEqual([])
  })

  it('重新启用 dsh-toolshed 不被拦（本插件没在跑时走不到这条路径）', async () => {
    const { manager, calls } = fakeManager()

    expect((await toggleBundle(manager, 'dsh-toolshed', true)).ok).toBe(true)
    expect(calls).toEqual([{ name: 'dsh-toolshed', enabled: true }])
  })

  it('别的包不受自管理判据影响（判据是包名，不是「名字里有 toolshed」）', async () => {
    const { manager, calls } = fakeManager()

    expect((await toggleBundle(manager, '@someone/toolshed-fork', false)).ok).toBe(true)
    expect(calls).toEqual([{ name: '@someone/toolshed-fork', enabled: false }])
  })
})

describe('resolvePluginManager / createPluginsAdmin', () => {
  it('ctx 既没有 get 也没有该属性时返回 undefined', () => {
    expect(resolvePluginManager({})).toBeUndefined()
    expect(resolvePluginManager({ get: () => undefined })).toBeUndefined()
  })

  it('鸭子类型只认两个方法：缺 setBundleEnabled 的服务不可用（老版本只有条目级能力）', () => {
    expect(resolvePluginManager({
      get: () => ({
        listPlugins: async () => [],
        setPluginEnabled: async () => ({ changed: true, application: 'applied' }),
        listBundles: async () => [],
      }),
    })).toBeUndefined()
    expect(resolvePluginManager({ get: () => ({ listBundles: async () => [] }) })).toBeUndefined()
  })

  it('两个方法都在才返回服务（顺手覆盖 ctx 属性兜底那条路径）', () => {
    const { manager } = fakeManager()
    expect(resolvePluginManager({ get: () => manager })).toBe(manager)
    expect(resolvePluginManager({ pluginManager: manager })).toBe(manager)
  })

  it('拆卸期取服务抛错时当成不可用，不让请求 500', () => {
    expect(resolvePluginManager({ get: () => { throw new Error('service disposed') } })).toBeUndefined()
  })

  it('服务缺失时 list / toggleBundle 都回可识别的机器码 plugin-manager-unavailable', async () => {
    const admin = createPluginsAdmin({})

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
    await expect(admin.toggleBundle({ name: 'some-bundle', enabled: true })).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
  })

  it('服务在 apply 之后才挂上也能拿到（惰性解析，不是构造期快照）', async () => {
    let mounted: PluginManagerService | undefined
    const admin = createPluginsAdmin({ get: name => (name === 'pluginManager' ? mounted : undefined) })

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })

    mounted = fakeManager([TOOLSHED_BUNDLE]).manager
    const response = await admin.list()
    expect(response.bundles.map(bundle => bundle.name)).toEqual(['dsh-toolshed'])
    // 响应只有 bundles：没有 plugins、也没有任何行级字段。
    expect(Object.keys(response)).toEqual(['bundles'])
  })
})
