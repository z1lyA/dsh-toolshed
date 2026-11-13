/**
 * 插件启停的纯逻辑规格测试。
 *
 * 为什么脱离 DSH 测：官方包不装成依赖（AGENTS 约束 4），`pluginManager` 只能鸭子类型化；
 * 投影与判定写成纯函数就是为了在这里用假 manager 把三条最容易回归的行为钉住：
 *
 *  - 官方 `application:'failed'` **不抛异常**——只 try/catch 会把失败当成功，页面于是显示「已启用」；
 *  - 停用 dsh-toolshed 自己必须被硬拒绝——否则面板当场消失、响应可能被 dispose 打断，用户没有恢复入口；
 *  - 服务缺失必须是可识别的机器码（503）——否则整页 500，或更糟：200 + 空列表被误读成「一个插件都没装」。
 */
import type { OfficialChangeResult, OfficialPluginInfo, PluginManagerService } from './plugins'
import { describe, expect, it } from 'vitest'
import { createPluginsAdmin, listPluginRows, PluginRequestError, resolvePluginManager, togglePlugin } from './plugins'
import { PLUGIN_MANAGER_UNAVAILABLE, PLUGIN_SELF_MANAGEMENT } from './plugins.types'

interface FakeManager {
  manager: PluginManagerService
  /** 每次 `setPluginEnabled` 的入参：用来断言「拒绝时没有真的去写用户 patch」。 */
  calls: Array<{ entryId: string, enabled: boolean }>
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

function fakeManager(rows: OfficialPluginInfo[], result?: OfficialChangeResult): FakeManager {
  const calls: Array<{ entryId: string, enabled: boolean }> = []
  return {
    calls,
    manager: {
      listPlugins: async () => rows,
      setPluginEnabled: async (entryId, enabled) => {
        calls.push({ entryId, enabled })
        return result ?? { changed: true, application: 'applied' }
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

describe('resolvePluginManager / createPluginsAdmin', () => {
  it('ctx 既没有 get 也没有该属性时返回 undefined', () => {
    expect(resolvePluginManager({})).toBeUndefined()
    expect(resolvePluginManager({ get: () => undefined })).toBeUndefined()
  })

  it('鸭子类型：缺 setPluginEnabled 的服务不可用（老版本可能只有 listPlugins）', () => {
    expect(resolvePluginManager({ get: () => ({ listPlugins: async () => [] }) })).toBeUndefined()
  })

  it('拆卸期取服务抛错时当成不可用，不让请求 500', () => {
    expect(resolvePluginManager({ get: () => { throw new Error('service disposed') } })).toBeUndefined()
  })

  it('两个方法都在才返回服务（顺手覆盖 ctx 属性兜底那条路径）', () => {
    const { manager } = fakeManager([])
    expect(resolvePluginManager({ get: () => manager })).toBe(manager)
    expect(resolvePluginManager({ pluginManager: manager })).toBe(manager)
  })

  it('服务缺失时 list / toggle 都回可识别的机器码 plugin-manager-unavailable', async () => {
    const admin = createPluginsAdmin({})

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
    await expect(admin.toggle({ entryId: 'include:bash-sandbox', enabled: true })).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })
  })

  it('服务在 apply 之后才挂上也能拿到（惰性解析，不是构造期快照）', async () => {
    let mounted: PluginManagerService | undefined
    const admin = createPluginsAdmin({ get: name => (name === 'pluginManager' ? mounted : undefined) })

    await expect(admin.list()).rejects.toMatchObject({ code: PLUGIN_MANAGER_UNAVAILABLE })

    mounted = fakeManager([SANDBOX_ROW]).manager
    expect(await admin.list()).toEqual({
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
