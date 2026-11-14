import type { PluginBundleView } from '../apis/index.type'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { localizedTextOf, PluginBundleCard, PluginRowItem, PluginsTab } from './plugins-tab'

/**
 * 「插件」页的渲染冒烟（v2：以 npm 包为单位）。
 *
 * 同 `extension-panel.render.test.tsx`：`renderToStaticMarkup` 不跑 `useEffect`（所以不会发请求），
 * 但组件导出、props 校验、`t()` 的键是否存在都会真实求值——`pnpm typecheck` 在缺宿主类型的
 * 机器上跑不了，这些错误本来只能等真机硬刷新才暴露。
 *
 * 卡片与行级断言直接喂数据：拉取结果在 SSR 阶段不存在，展开态也只能靠 props 传入。
 */
const t = locale.text

const thirdParty: PluginBundleView = {
  name: 'dsh-toolshed',
  official: false,
  installed: true,
  enabled: true,
  availability: 'profile',
  version: '2.2.0',
  title: { en: 'Toolshed', zh: '工具管理' },
  description: { en: 'Everything the desktop extension panel adds.', zh: '桌面扩展面板的全部功能。' },
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  rows: [
    { rowId: 'include:toolshed', moduleName: 'dsh-toolshed', entryId: 'include:toolshed', enabled: true, fiberPhase: 'active', patchId: 'toolshed' },
  ],
}

const official: PluginBundleView = {
  name: '@deepseek-ai/dsh-pwsh-sandbox',
  official: true,
  installed: true,
  enabled: true,
  availability: 'installation',
  title: '沙箱',
  manifestDescription: 'Command sandbox for the desktop host.',
  rows: [],
}

const noop = (): void => {}

describe('插件页（包级视图）', () => {
  it('载入态就有标题、解释 200+ 条目的说明、文字「刷新」、市场按钮、三档筛选与搜索框', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} openMarket={noop} />)

    expect(html).toContain(t('pluginsTitle'))
    // 说明文案回答的是「为什么有两百多个插件」：按包展示，一个包带多条 Loader 条目。
    expect(html).toContain(t('pluginsIntroV2'))
    expect(html).toContain(`data-prim="Button">${t('refresh')}<`)
    expect(html).toContain(t('pluginMarket'))
    // 默认「第三方」：三档都在，但选中态在第三方（SegmentedControl 用 aria-pressed 表示非 tab 组）。
    for (const key of ['pluginsFilterAll', 'pluginsFilterThirdParty', 'pluginsFilterOfficial'] as const)
      expect(html, key).toContain(t(key))
    expect(html).toContain('role="group"')
    expect(html).toContain('data-prim="Input"')
    expect(html).toContain(t('loading'))
    expect(html).not.toContain('undefined')
  })

  it('拿不到市场入口时按钮不渲染（三级降级全失败）', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} />)

    expect(html).not.toContain(t('pluginMarket'))
    expect(html).not.toContain('undefined')
  })

  it('第三方包卡片：图标 data URL、标题、版本、一句话简介、状态与可用开关', () => {
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={thirdParty} busy={false} expanded={false} onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).toContain(`src="${thirdParty.icon}"`)
    // resolveText 缺席时退回 en（组件不自己挑语言）
    expect(html).toContain('Toolshed')
    expect(html).toContain('2.2.0')
    expect(html).toContain(thirdParty.description.en)
    expect(html).toContain(t('pluginEnabled'))
    // 全名始终留在 title 上（标题是本地化文案，包名才是稳定标识）
    expect(html).toContain(`title="${thirdParty.name}"`)
    expect(html).toContain('data-prim="Switch"')
    expect(html).not.toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })

  it('没有图标时退回 Puzzle，没有标题时退回包名', () => {
    const bundle: PluginBundleView = { ...official, title: undefined }
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={bundle} busy={false} expanded={false} onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).not.toContain('<img')
    expect(html).toContain('<svg')
    expect(html).toContain(bundle.name)
    // 没有本地化简介时退回 manifest 的原始 description
    expect(html).toContain('Command sandbox for the desktop host.')
    expect(html).not.toContain('undefined')
  })

  it('官方包：开关禁用，并给出「请在官方插件页管理」的原因', () => {
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={official} busy={false} expanded={false} onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).toContain('data-prim="Switch"')
    expect(html).toContain('data-disabled="true"')
    expect(html).toContain(t('pluginOfficialManage'))
    expect(html).toContain(`title="${t('pluginOfficialManage')}"`)
    expect(html).not.toContain('undefined')
  })

  it('官方给了 readOnlyReason 的包：显示官方原因而不是笼统文案', () => {
    const bundle: PluginBundleView = { ...thirdParty, readOnlyReason: 'management-required' }
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={bundle} busy={false} expanded={false} onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).toContain('data-disabled="true"')
    expect(html).toContain(t('pluginReasonManagement'))
    expect(html).not.toContain('undefined')
  })

  it('展开后行可见：每行 moduleName + entryId + 状态 + 开关', () => {
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={thirdParty} busy={false} expanded onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).toContain('dshp-extension__plugin-card-rows')
    expect(html).toContain('>dsh-toolshed</strong>')
    expect(html).toContain('include:toolshed')
    expect(html).toContain(t('pluginPhaseActive'))
    expect(html).not.toContain('undefined')
  })

  it('展开但包内没有行时给一句空态，而不是空白', () => {
    const html = renderToStaticMarkup(
      <PluginBundleCard t={t} bundle={official} busy={false} expanded onToggleExpanded={noop} onToggleBundle={noop} onToggleRow={noop} />,
    )

    expect(html).toContain(t('pluginRowsEmpty'))
    expect(html).not.toContain('undefined')
  })
})

describe('包内 Loader 条目', () => {
  it('有 patchId 与 entryId 的行可以点（官方包里的行也给，粒度细、可逆）', () => {
    const html = renderToStaticMarkup(
      <PluginRowItem
        t={t}
        busy={false}
        onToggle={noop}
        row={{ rowId: 'include:sandbox', moduleName: '@deepseek-ai/dsh-pwsh-sandbox', entryId: 'include:sandbox', enabled: true, fiberPhase: 'failed', patchId: 'pwsh-sandbox' }}
      />,
    )

    expect(html).toContain(t('pluginEnabled'))
    expect(html).toContain(t('pluginPhaseFailed'))
    // 前缀只在展示时省略，全名仍留在 title 上
    expect(html).toContain('>dsh-pwsh-sandbox</strong>')
    expect(html).toContain('title="@deepseek-ai/dsh-pwsh-sandbox"')
    expect(html).not.toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })

  it('包已停用（行没有 entryId）时开关禁用，并说明先启用包', () => {
    const html = renderToStaticMarkup(
      <PluginRowItem
        t={t}
        busy={false}
        onToggle={noop}
        row={{ rowId: 'include:sandbox', moduleName: '@deepseek-ai/dsh-pwsh-sandbox', enabled: false, fiberPhase: null }}
      />,
    )

    expect(html).toContain('data-disabled="true"')
    expect(html).toContain(t('pluginRowNoEntry'))
    // 没有 entryId 时用 rowId 占位，不渲染空串
    expect(html).toContain('include:sandbox')
    expect(html).not.toContain('undefined')
  })

  it('官方给了原因码时按官方文案禁用', () => {
    for (const [reason, key] of [['management-required', 'pluginReasonManagement'], ['unaddressable', 'pluginReasonUnaddressable']] as const) {
      const html = renderToStaticMarkup(
        <PluginRowItem
          t={t}
          busy={false}
          onToggle={noop}
          row={{ rowId: 'include:x', moduleName: '@deepseek-ai/dsh-x', entryId: 'include:x', enabled: true, fiberPhase: 'active', readOnlyReason: reason }}
        />,
      )

      expect(html, reason).toContain('data-disabled="true"')
      expect(html, reason).toContain(`title="${t(key)}"`)
      expect(html, reason).not.toContain('undefined')
    }
  })
})

describe('localizedTextOf', () => {
  it('prefers the injected runtime resolver over the raw shape', () => {
    const text = { en: 'Official', zh: '官方' }
    expect(localizedTextOf(text, () => '官方')).toBe('官方')
  })

  it('falls back to en when there is no resolver or it resolves to nothing', () => {
    const text = { en: 'Official', zh: '官方' }
    expect(localizedTextOf(text)).toBe('Official')
    expect(localizedTextOf(text, () => '')).toBe('Official')
    expect(localizedTextOf(text, () => { throw new Error('locale disposed') })).toBe('Official')
  })

  it('passes literals through when there is no resolver, and renders absence as an empty string', () => {
    expect(localizedTextOf('已经是一句话')).toBe('已经是一句话')
    // 有解析器时以运行时为准（字面量会被官方原样返回，行为与不注入时一致）
    expect(localizedTextOf('已经是一句话', text => (typeof text === 'string' ? text : text.en))).toBe('已经是一句话')
    expect(localizedTextOf(undefined)).toBe('')
  })
})
