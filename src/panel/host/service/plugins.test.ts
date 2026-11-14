/**
 * 插件启停的纯逻辑规格测试。
 *
 * 为什么脱离 DSH 测：官方包不装成依赖（AGENTS 约束 4），`pluginManager` 只能鸭子类型化；
 * 投影与判定写成纯函数就是为了在这里用假 manager 把最容易回归的行为钉住：
 *
 *  - 官方 `application:'failed'` **不抛异常**——只 try/catch 会把失败当成功，页面于是显示「已启用」；
 *  - 停用 dsh-toolshed 自己必须被硬拒绝（行级与包级两条路径）——否则面板当场消失、用户没有恢复入口；
 *  - 服务缺失必须是可识别的机器码（503）——否则整页 500，或更糟：200 + 空列表被误读成「一个插件都没装」；
 *  - 包级投影的 join / 排序 / 丢弃规则——照官方 `BundleInfo` 的形状搬字段，官方漂移时要降级而不是 500。
 */
import type { OfficialBundleInfo, OfficialChangeResult, OfficialPluginInfo, PluginManagerService } from './plugins'
import { describe, expect, it } from 'vitest'
import {
  createPluginsAdmin,
  listPluginBundles,
  listPluginInventory,
  listPluginRows,
  PluginRequestError,
  resolvePluginManager,
  toggleBundle,
  togglePlugin,
} from './plugins'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

interface FakeManager {
  manager: PluginManagerService
  /** 每次 `setPluginEnabled` 的入参：用来断言「拒绝时没有真的去写用户 patch」。 */
  calls: Array<{ entryId: string, enabled: boolean }>
  /** 每次 `setBundleEnabled` 的入参，同理。 */
  bundleCalls: Array<{ name: string, enabled: boolean }>
}

const SELF_ROW: OfficialPluginInfo = {
  entryId: 'include:dsh-toolshed',
  moduleName: 'dsh-toolshed',
  enabled: true,
  fiberPhase: 'active',
  patchId: 'dsh-toolshed',
}

const SANDBOX_ROW: OfficialPluginInfo = {
  entryId: 'include:bash-sandbox',
  moduleName: '@deepseek-ai/dsh-pwsh-sandbox',
  enabled: true,
  fiberPhase: 'active',
  patchId: 'bash-sandbox',
}

const PROTECTED_ROW: OfficialPluginInfo = {
  entryId: 'include:hmr',
  moduleName: '@deepseek-ai/dsh-hmr',
  enabled: true,
  fiberPhase: 'active',
  readOnlyReason: 'management-required',
}

function fakeManager(
  rows: OfficialPluginInfo[],
  result?: OfficialChangeResult,
  bundles: OfficialBundleInfo[] = [],
  bundleResult?: OfficialChangeResult,
): FakeManager {
  const calls: Array<{ entryId: string, enabled: boolean }> = []
  const bundleCalls: Array<{ name: string, enabled: boolean }> = []
  return {
    calls,
    bundleCalls,
    manager: {
      listPlugins: async () => rows,
      setPluginEnabled: async (entryId, enabled) => {
        calls.push({ entryId, enabled })
        return result ?? { changed: true, application: 'applied' }
      },
      listBundles: async () => bundles,
      setBundleEnabled: async (name, enabled) => {
        bundleCalls.push({ name, enabled })
        return bundleResult ?? { changed: true, application: 'applied' }
      },
    },
  }
}

describe('listPluginRows（官方条目 → 线协议行）', () => {
  it('逐字段投影，patchId 只在可启停时出现', async () => {
    const { manager } = fakeManager([SANDBOX_ROW, PROTECTED_ROW, SELF_ROW])

    expect(await listPluginRows(manager)).toEqual([
      {
        entryId: 'include:bash-sandbox',
        moduleName: '@deepseek-ai/dsh-pwsh-sandbox',
        enabled: true,
        fiberPhase: 'active',
        patchId: 'bash-sandbox',
      },
      {
        entryId: 'include:hmr',
        moduleName: '@deepseek-ai/dsh-hmr',
        enabled: true,
        fiberPhase: 'active',
        readOnlyReason: 'management-required',
      },
      {
        entryId: 'include:dsh-toolshed',
        moduleName: 'dsh-toolshed',
        enabled: true,
        fiberPhase: 'active',
        patchId: 'dsh-toolshed',
      },
    ])
  })

  it('readOnlyReason 原样透出（不翻译、不收窄取值），fiberPhase 缺失归 null', async () => {
    const { manager } = fakeManager([
      { entryId: 'include:future', moduleName: 'x', enabled: false, readOnlyReason: 'some-future-code' },
    ])

    const rows = await listPluginRows(manager)
    expect(rows).toHaveLength(1)
    expect(rows[0].readOnlyReason).toBe('some-future-code')
    expect(rows[0].fiberPhase).toBeNull()
    expect(rows[0].enabled).toBe(false)
  })

  it('形状不对的条目被丢弃：一条坏数据不该让整页 500', async () => {
    const { manager } = fakeManager([
      null as unknown as OfficialPluginInfo,
      { entryId: 42, moduleName: 'x' } as unknown as OfficialPluginInfo,
      SANDBOX_ROW,
    ])

    const rows = await listPluginRows(manager)
    expect(rows).toHaveLength(1)
    expect(rows[0].entryId).toBe('include:bash-sandbox')
  })
})

describe('togglePlugin：application 原样透出，只判 ok', () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['applied', true],
    ['restart-required', true],
    ['overridden', true],
    ['failed', false],
    ['cancelled', false],
  ]

  for (const [application, ok] of cases) {
    it(`${application} → ok:${ok}`, async () => {
      const { manager, calls } = fakeManager([SANDBOX_ROW], { changed: true, application })

      const response = await togglePlugin(manager, 'include:bash-sandbox', false)
      expect(response).toEqual({ ok, application, changed: true })
      expect(calls).toEqual([{ entryId: 'include:bash-sandbox', enabled: false }])
    })
  }

  it('failed 不抛异常，如实透出 errorCode 与 diagnostic（此时文件可能已经写了）', async () => {
    const { manager } = fakeManager([SANDBOX_ROW], {
      changed: true,
      application: 'failed',
      error: { code: 'operation-error', diagnostic: 'loader rejected the entry' },
    })

    const response = await togglePlugin(manager, 'include:bash-sandbox', true)
    expect(response).toEqual({
      ok: false,
      application: 'failed',
      changed: true,
      errorCode: 'operation-error',
      diagnostic: 'loader rejected the entry',
    })
  })

  it('readOnlyReason 行不预先拒绝：官方自己的 management-required 原样回到页面', async () => {
    const { manager, calls } = fakeManager([PROTECTED_ROW], {
      changed: false,
      application: 'failed',
      error: { code: 'management-required' },
    })

    const response = await togglePlugin(manager, 'include:hmr', false)
    expect(response).toEqual({ ok: false, application: 'failed', changed: false, errorCode: 'management-required' })
    expect(calls).toHaveLength(1)
  })

  it('未知 entryId 交给官方判定（unknown-plugin 是业务结论，不是 5xx）', async () => {
    const { manager, calls } = fakeManager([SANDBOX_ROW], {
      changed: false,
      application: 'failed',
      error: { code: 'unknown-plugin' },
    })

    const response = await togglePlugin(manager, 'include:gone', false)
    expect(response).toEqual({ ok: false, application: 'failed', changed: false, errorCode: 'unknown-plugin' })
    expect(calls).toEqual([{ entryId: 'include:gone', enabled: false }])
  })
})

describe('togglePlugin：硬拒绝停用本面板自己', () => {
  it('停用 dsh-toolshed → self-management，且没有真的去写用户 patch', async () => {
    const { manager, calls } = fakeManager([SELF_ROW])

    await expect(togglePlugin(manager, 'include:dsh-toolshed', false)).rejects.toBeInstanceOf(PluginRequestError)
    await expect(togglePlugin(manager, 'include:dsh-toolshed', false)).rejects.toMatchObject({ code: PLUGIN_SELF_MANAGEMENT })
    expect(calls).toEqual([])
  })

  it('patchId 命中 dsh-toolshed 时同样拒绝（改名/别名安装的形态）', async () => {
    const { manager, calls } = fakeManager([{ ...SELF_ROW, moduleName: '@someone/toolshed-fork' }])

    await expect(togglePlugin(manager, 'include:dsh-toolshed', false)).rejects.toMatchObject({ code: PLUGIN_SELF_MANAGEMENT })
    expect(calls).toEqual([])
  })

  it('重新启用自己不被拦（本插件没在跑时走不到这条路径）', async () => {
    const { manager, calls } = fakeManager([{ ...SELF_ROW, enabled: false, fiberPhase: null }])

    const response = await togglePlugin(manager, 'include:dsh-toolshed', true)
    expect(response.ok).toBe(true)
    expect(calls).toEqual([{ entryId: 'include:dsh-toolshed', enabled: true }])
  })
})

describe('listPluginBundles（官方包 → 线协议包）', () => {
  const TOOLSHED_BUNDLE: OfficialBundleInfo = {
    name: 'dsh-toolshed',
    official: false,
    installed: true,
    enabled: true,
    availability: 'profile',
    version: '2.2.0',
    meta: {
      title: { en: 'Dsh Toolshed', zh: '工具箱' },
      description: { en: 'Panel tweaks', zh: '面板增强' },
      icon: 'data:image/png;base64,AAAA',
      // 官方在 meta 里也放一份加载失败文案；v2 不透出它（机器码走 error.code）。
      error: 'boom',
    },
    description: 'manifest description (not localized)',
    rows: [
      { rowId: 'include:dsh-toolshed', moduleName: 'dsh-toolshed', entryId: 'include:dsh-toolshed' },
    ],
  }

  it('包字段原样透传，rows 按 entryId join 回条目状态', async () => {
    const { manager } = fakeManager([SELF_ROW, SANDBOX_ROW, PROTECTED_ROW], undefined, [
      {
        ...TOOLSHED_BUNDLE,
        rows: [
          { rowId: 'include:dsh-toolshed', moduleName: 'dsh-toolshed', entryId: 'include:dsh-toolshed' },
          { rowId: 'include:bash-sandbox', moduleName: '@deepseek-ai/dsh-pwsh-sandbox', entryId: 'include:bash-sandbox' },
          { rowId: 'include:hmr', moduleName: '@deepseek-ai/dsh-hmr', entryId: 'include:hmr' },
        ],
      },
    ])

    expect(await listPluginBundles(manager)).toEqual([{
      name: 'dsh-toolshed',
      official: false,
      installed: true,
      enabled: true,
      availability: 'profile',
      version: '2.2.0',
      title: { en: 'Dsh Toolshed', zh: '工具箱' },
      description: { en: 'Panel tweaks', zh: '面板增强' },
      icon: 'data:image/png;base64,AAAA',
      manifestDescription: 'manifest description (not localized)',
      rows: [
        { rowId: 'include:dsh-toolshed', moduleName: 'dsh-toolshed', entryId: 'include:dsh-toolshed', enabled: true, fiberPhase: 'active', patchId: 'dsh-toolshed' },
        { rowId: 'include:bash-sandbox', moduleName: '@deepseek-ai/dsh-pwsh-sandbox', entryId: 'include:bash-sandbox', enabled: true, fiberPhase: 'active', patchId: 'bash-sandbox' },
        { rowId: 'include:hmr', moduleName: '@deepseek-ai/dsh-hmr', entryId: 'include:hmr', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' },
      ],
    }])
  })

  it('meta.error 丢掉、manifest 原文落在 manifestDescription（不与本地化 description 混用）', async () => {
    const { manager } = fakeManager([], undefined, [TOOLSHED_BUNDLE])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle.manifestDescription).toBe('manifest description (not localized)')
    expect(bundle.description).toEqual({ en: 'Panel tweaks', zh: '面板增强' })
    expect(JSON.stringify(bundle)).not.toContain('boom')
  })

  it('没有 entryId 的行（包被整体停用）enabled:false / fiberPhase:null，且不带 patchId', async () => {
    const { manager } = fakeManager([SANDBOX_ROW], undefined, [
      {
        ...TOOLSHED_BUNDLE,
        enabled: false,
        rows: [{ rowId: 'include:dsh-toolshed', moduleName: 'dsh-toolshed' }],
      },
    ])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle.enabled).toBe(false)
    expect(bundle.rows).toEqual([
      { rowId: 'include:dsh-toolshed', moduleName: 'dsh-toolshed', enabled: false, fiberPhase: null },
    ])
    expect(bundle.rows[0].entryId).toBeUndefined()
    expect(bundle.rows[0].patchId).toBeUndefined()
  })

  it('entryId join 落空时同样按「没有存活条目」处理（不假装可启停）', async () => {
    const { manager } = fakeManager([], undefined, [
      { ...TOOLSHED_BUNDLE, rows: [{ rowId: 'include:gone', moduleName: 'gone', entryId: 'include:gone' }] },
    ])

    const [bundle] = await listPluginBundles(manager)
    expect(bundle.rows).toEqual([
      { rowId: 'include:gone', moduleName: 'gone', entryId: 'include:gone', enabled: false, fiberPhase: null },
    ])
    expect(bundle.rows[0].patchId).toBeUndefined()
  })

  it('icon 超过 64 KiB 被丢弃，恰好 64 KiB 仍透传（二十多个包全带上会撑到几 MB）', async () => {
    const limit = 64 * 1024
    const { manager } = fakeManager([], undefined, [
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
    const { manager } = fakeManager([], undefined, [
      { ...TOOLSHED_BUNDLE, name: 'aaa-official', official: true },
      { ...TOOLSHED_BUNDLE, name: 'zzz-third-party' },
      { ...TOOLSHED_BUNDLE, name: 'mmm-official', official: true },
      { ...TOOLSHED_BUNDLE, name: 'bbb-third-party' },
    ])

    expect((await listPluginBundles(manager)).map(bundle => bundle.name))
      .toEqual(['bbb-third-party', 'zzz-third-party', 'aaa-official', 'mmm-official'])
  })

  it('形状不对的包被跳过：一条坏数据不该让整页 500', async () => {
    const { manager } = fakeManager([], undefined, [
      null as unknown as OfficialBundleInfo,
      { name: 42 } as unknown as OfficialBundleInfo,
      { name: '' } as unknown as OfficialBundleInfo,
      // availability 是页面的状态判据，缺了就无法如实展示，宁可整包不出现。
      { name: 'no-availability', official: false, rows: [] } as unknown as OfficialBundleInfo,
      TOOLSHED_BUNDLE,
    ])

    const bundles = await listPluginBundles(manager)
    expect(bundles).toHaveLength(1)
    expect(bundles[0].name).toBe('dsh-toolshed')
  })

  it('rows 缺失或空时给空数组（页面展开是空的，但包本身还在）', async () => {
    const { manager } = fakeManager([], undefined, [
      { ...TOOLSHED_BUNDLE, name: 'no-rows', rows: undefined as unknown as [] },
    ])

    expect((await listPluginBundles(manager))[0].rows).toEqual([])
  })

  it('listPluginInventory 一次给出双清单：包级主视图 + 扁平条目', async () => {
    const { manager } = fakeManager([SANDBOX_ROW], undefined, [TOOLSHED_BUNDLE])

    const inventory = await listPluginInventory(manager)
    expect(inventory.bundles.map(bundle => bundle.name)).toEqual(['dsh-toolshed'])
    expect(inventory.plugins).toEqual([{
      entryId: 'include:bash-sandbox',
      moduleName: '@deepseek-ai/dsh-pwsh-sandbox',
      enabled: true,
      fiberPhase: 'active',
      patchId: 'bash-sandbox',
    }])
  })
})

describe('toggleBundle：application 判定与行级共用', () => {
  it('透出官方的 failed + errorCode（此时文件可能已经写了）', async () => {
    const { manager, bundleCalls } = fakeManager([], undefined, [], {
      changed: true,
      application: 'failed',
      error: { code: 'bundle-in-use', diagnostic: 'a live fiber is using this bundle' },
    })

    const response = await toggleBundle(manager, 'some-bundle', false)
    expect(response).toEqual({
      ok: false,
      application: 'failed',
      changed: true,
      errorCode: 'bundle-in-use',
      diagnostic: 'a live fiber is using this bundle',
    })
    expect(bundleCalls).toEqual([{ name: 'some-bundle', enabled: false }])
  })

  it('停用 dsh-toolshed 包 → self-management，且没有真的去写用户 patch', async () => {
    const { manager, bundleCalls } = fakeManager([])

    await expect(toggleBundle(manager, 'dsh-toolshed', false)).rejects.toBeInstanceOf(PluginRequestError)
    await expect(toggleBundle(manager, 'dsh-toolshed', false)).rejects.toMatchObject({ code: PLUGIN_SELF_MANAGEMENT })
    expect(bundleCalls).toEqual([])
  })

  it('重新启用 dsh-toolshed 包不被拦（本插件没在跑时走不到这条路径）', async () => {
    const { manager, bundleCalls } = fakeManager([])

    expect((await toggleBundle(manager, 'dsh-toolshed', true)).ok).toBe(true)
    expect(bundleCalls).toEqual([{ name: 'dsh-toolshed', enabled: true }])
  })
})

describe('resolvePluginManager / createPluginsAdmin', () => {
  it('ctx 既没有 get 也没有该属性时返回 undefined', () => {
    expect(resolvePluginManager({})).toBeUndefined()
    expect(resolvePluginManager({ get: () => undefined })).toBeUndefined()
  })

  it('鸭子类型：缺 setPluginEnabled 的服务不可用（老版本可能只有 listPlugins）', () => {
    expect(resolvePluginManager({ get: () => ({ listPlugins: async () => [] }) })).toBeUndefined()
  })

  it('鸭子类型：缺 listBundles / setBundleEnabled 的服务同样不可用（2.1.x 的宿主没有包级能力）', () => {
    const listPlugins = async () => []
    const setPluginEnabled = async () => ({ changed: true, application: 'applied' })
    const listBundles = async () => []
    const setBundleEnabled = async () => ({ changed: true, application: 'applied' })

    expect(resolvePluginManager({
      get: () => ({ listPlugins, setPluginEnabled, setBundleEnabled }),
    })).toBeUndefined()
    expect(resolvePluginManager({
      get: () => ({ listPlugins, setPluginEnabled, listBundles }),
    })).toBeUndefined()
  })

  it('拆卸期取服务抛错时当成不可用，不让请求 500', () => {
    expect(resolvePluginManager({ get: () => { throw new Error('service disposed') } })).toBeUndefined()
  })

  it('四个方法都在才返回服务（顺手覆盖 ctx 属性兜底那条路径）', () => {
    const { manager } = fakeManager([])
    expect(resolvePluginManager({ get: () => manager })).toBe(manager)
    expect(resolvePluginManager({ pluginManager: manager })).toBe(manager)
  })

  it('服务缺失时 list / toggle / toggleBundle 都回可识别的机器码 plugin-manager-unavailable', async () => {
    const admin = createPluginsAdmin({})

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
    await expect(admin.toggle({ entryId: 'include:bash-sandbox', enabled: true })).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
    await expect(admin.toggleBundle({ name: 'some-bundle', enabled: true })).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
  })

  it('服务在 apply 之后才挂上也能拿到（惰性解析，不是构造期快照）', async () => {
    let mounted: PluginManagerService | undefined
    const admin = createPluginsAdmin({ get: name => (name === 'pluginManager' ? mounted : undefined) })

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })

    mounted = fakeManager([SANDBOX_ROW]).manager
    expect(await admin.list()).toEqual({
      bundles: [],
      plugins: [{
        entryId: 'include:bash-sandbox',
        moduleName: '@deepseek-ai/dsh-pwsh-sandbox',
        enabled: true,
        fiberPhase: 'active',
        patchId: 'bash-sandbox',
      }],
    })
  })
})
