import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { PluginRowItem, PluginsTab } from './plugins-tab'

/**
 * 「插件」页的渲染冒烟。
 *
 * 同 `extension-panel.render.test.tsx`：`renderToStaticMarkup` 不跑 `useEffect`（所以不会发请求），
 * 但组件导出、props 校验、`t()` 的键是否存在都会真实求值——`pnpm typecheck` 在缺宿主类型的
 * 机器上跑不了，这些错误本来只能等真机硬刷新才暴露。
 *
 * 行级断言直接喂 `PluginRowItem` 一行数据：拉取结果在 SSR 阶段不存在，只能这么覆盖。
 */
const t = locale.text

describe('插件页', () => {
  it('载入态就有标题、说明、文字「刷新」、市场按钮与搜索框', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} openMarket={() => {}} />)

    expect(html).toContain(t('pluginsTitle'))
    expect(html).toContain(t('pluginsIntro'))
    // 刷新是文字按钮（右上角重启控件已经占了一个刷新图标）
    expect(html).toContain(`data-prim="Button">${t('refresh')}<`)
    expect(html).toContain(t('pluginMarket'))
    // 搜索框：227 条清单没有搜索不可用。placeholder/aria-label 走的是 `pluginSearch`，
    // 但测试替身只转发 children/title，所以这里断言控件本身在（键的存在性由 t() 抛错覆盖）。
    expect(html).toContain('data-prim="Input"')
    expect(t('pluginSearch')).toEqual(expect.any(String))
    expect(html).toContain(t('loading'))
    expect(html).not.toContain('undefined')
  })

  it('拿不到市场入口时按钮不渲染（三级降级全失败）', () => {
    const html = renderToStaticMarkup(<PluginsTab t={t} />)

    expect(html).not.toContain(t('pluginMarket'))
    expect(html).not.toContain('undefined')
  })

  it('不可启停的行：开关禁用，原因按官方文案挂在 title 上', () => {
    for (const [reason, key] of [['management-required', 'pluginReasonManagement'], ['unaddressable', 'pluginReasonUnaddressable']] as const) {
      const html = renderToStaticMarkup(
        <PluginRowItem
          t={t}
          busy={false}
          onToggle={() => {}}
          row={{ entryId: 'include:bash-sandbox', moduleName: '@deepseek-ai/dsh-pwsh-sandbox', enabled: true, fiberPhase: 'active', readOnlyReason: reason }}
        />,
      )

      expect(html, reason).toContain('data-prim="Switch"')
      expect(html, reason).toContain('data-disabled="true"')
      expect(html, reason).toContain(`title="${t(key)}"`)
      // 前缀只在展示时省略，全名仍留在 title 上
      expect(html, reason).toContain('>dsh-pwsh-sandbox</strong>')
      expect(html, reason).toContain('title="@deepseek-ai/dsh-pwsh-sandbox"')
      expect(html, reason).not.toContain('undefined')
    }
  })

  it('可启停的行：开关可用，并显示启用状态与存活阶段', () => {
    const html = renderToStaticMarkup(
      <PluginRowItem
        t={t}
        busy={false}
        onToggle={() => {}}
        row={{ entryId: 'include:toolshed', moduleName: 'dsh-toolshed', enabled: true, fiberPhase: 'failed' }}
      />,
    )

    expect(html).toContain(t('pluginEnabled'))
    expect(html).toContain(t('pluginPhaseFailed'))
    expect(html).not.toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })
})
