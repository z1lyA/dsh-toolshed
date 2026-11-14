import type { PluginBundleView } from '../apis/index.type'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { bundleToggleReasonOf, localizedTextOf, PluginBundleCard, PluginsTab } from './plugins-tab'

/**
 * 「插件」页的渲染冒烟（2.3.0：**只有 npm 包**，没有 Loader 条目）。
 *
 * 同 `extension-panel.render.test.tsx`：`renderToStaticMarkup` 不跑 `useEffect`（所以不会发请求），
 * 但组件导出、props 校验、`t()` 的键是否存在都会真实求值——`pnpm typecheck` 在缺宿主类型的
 * 机器上跑不了，这些错误本来只能等真机硬刷新才暴露。
 *
 * 卡片断言直接喂数据：拉取结果在 SSR 阶段不存在。
 */
const t = locale.text

const thirdParty: PluginBundleView = {
  name: 'dsh-toolshed',
  official: false,
  installed: true,
  enabled: true,
  availability: 'profile',
  version: '2.3.0',
  title: { en: 'Toolshed', zh: '工具管理' },
  description: { en: 'Everything the desktop extension panel adds.', zh: '桌面扩展面板的全部功能。' },
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
}

const official: PluginBundleView = {
  name: '@deepseek-ai/dsh-pwsh-sandbox',
  official: true,
  installed: true,
  enabled: true,
  availability: 'installation',
  title: '沙箱',
  manifestDescription: 'Command sandbox for the desktop host.',
}

const noop = (): void => {}

/** 卡片 props 只有四个：没有展开态，也没有行级回调。 */
function card(bundle: PluginBundleView): string {
  return renderToStaticMarkup(<PluginBundleCard t={t} bundle={bundle} busy={false} onToggleBundle={noop} />)
}

describe('插件页（纯包级视图）', () => {
  it('载入态就有标题、包级说明、文字「刷新」、市场按钮、三档筛选与搜索框', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} openMarket={noop} />)

    expect(html).toContain(t('pluginsTitle'))
    // 说明文案是纯包级口径：一个包可能含多条内部模块，条目级开关在官方页。
    expect(html).toContain(t('pluginsIntroV2'))
    expect(html).toContain(`data-prim="Button">${t('refresh')}<`)
    expect(html).toContain(t('pluginMarket'))
    // 默认「第三方」：三档都在，选中态在第三方（SegmentedControl 用 aria-pressed 表示非 tab 组）。
    for (const key of ['pluginsFilterAll', 'pluginsFilterThirdParty', 'pluginsFilterOfficial'] as const)
      expect(html, key).toContain(t(key))
    expect(html).toContain('role="group"')
    expect(html).toContain('data-prim="Input"')
    expect(html).toContain(t('loading'))
    expect(html).not.toContain('undefined')
  })

  it('计数只报包数：模板只有 bundles 一个占位符，不再有「条目」那一半', () => {
    const count = t('pluginsCount', { bundles: 3 })

    expect(count).toContain('3')
    // 未替换的占位符会原样留在文案里：出现 `{` 就说明还有第二个计数维度。
    expect(count).not.toContain('{')
    // 行级文案键已随条目列表一起删除（词典缺键时 `text()` 原样返回键名）。
    for (const key of ['pluginRowNoEntry', 'pluginRowsEmpty', 'pluginExpand'])
      expect((t as (key: string) => string)(key), key).toBe(key)
  })

  it('拿不到市场入口时按钮不渲染（三级降级全失败）', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} />)

    expect(html).not.toContain(t('pluginMarket'))
    expect(html).not.toContain('undefined')
  })

  it('第三方包卡片：图标 data URL、标题、版本、一句话简介、状态与可点开关', () => {
    const html = card(thirdParty)

    expect(html).toContain(`src="${thirdParty.icon}"`)
    // resolveText 缺席时退回 en（组件不自己挑语言）
    expect(html).toContain('Toolshed')
    expect(html).toContain('2.3.0')
    expect(html).toContain((thirdParty.description as { en: string }).en)
    expect(html).toContain(t('pluginEnabled'))
    // 全名始终留在 title 上（标题是本地化文案，包名才是稳定标识）
    expect(html).toContain(`title="${thirdParty.name}"`)
    expect(html).toContain('data-prim="Switch"')
    expect(html).not.toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })

  it('没有图标时退回 Puzzle，没有标题时退回包名', () => {
    const bundle: PluginBundleView = { ...official, title: undefined }
    const html = card(bundle)

    expect(html).not.toContain('<img')
    expect(html).toContain('<svg')
    expect(html).toContain(bundle.name)
    // 没有本地化简介时退回 manifest 的原始 description
    expect(html).toContain('Command sandbox for the desktop host.')
    expect(html).not.toContain('undefined')
  })

  it('卡片里没有任何可展开的东西：没有条目列表、没有展开语义、没有包内 moduleName', () => {
    const html = card(thirdParty)

    expect(html).not.toContain('dshp-extension__plugin-card-rows')
    expect(html).not.toContain('aria-expanded')
    // 包内条目名不该出现在纯包级视图里
    expect(html).not.toContain('include:')
    expect(html.match(/<ul/g) ?? []).toHaveLength(0)
    expect(html).not.toContain('undefined')
  })

  it('官方包：开关禁用，并给出「请在官方插件页管理」的原因', () => {
    const html = card(official)

    expect(html).toContain('data-prim="Switch"')
    expect(html).toContain('data-disabled="true"')
    expect(html).toContain(t('pluginOfficialManage'))
    expect(html).toContain(`title="${t('pluginOfficialManage')}"`)
    expect(html).not.toContain('undefined')
  })

  it('官方给了 readOnlyReason 的包：显示官方原因而不是笼统文案', () => {
    for (const [reason, key] of [['management-required', 'pluginReasonManagement'], ['unaddressable', 'pluginReasonUnaddressable']] as const) {
      const bundle: PluginBundleView = { ...thirdParty, readOnlyReason: reason }
      const html = card(bundle)

      expect(html, reason).toContain('data-disabled="true"')
      expect(html, reason).toContain(`title="${t(key)}"`)
      expect(html, reason).not.toContain('undefined')
    }
  })

  it('禁用原因：官方原因优先于「官方包」这一档', () => {
    expect(bundleToggleReasonOf(t, thirdParty)).toBeUndefined()
    expect(bundleToggleReasonOf(t, official)).toBe(t('pluginOfficialManage'))
    expect(bundleToggleReasonOf(t, { ...official, readOnlyReason: 'management-required' })).toBe(t('pluginReasonManagement'))
    // 官方新增的原因码原样透出，不猜文案
    expect(bundleToggleReasonOf(t, { ...thirdParty, readOnlyReason: 'some-future-code' })).toBe('some-future-code')
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
