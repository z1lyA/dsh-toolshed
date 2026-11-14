import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { ArchiveTab } from './archive-tab'
import { ExtensionPanel } from './extension-panel'
import { RestartControl } from './restart-control'

/**
 * tab 行与各页的渲染冒烟。
 *
 * 为什么值得单独测：esbuild 只做语法/模块解析，而 `pnpm typecheck` 在缺宿主类型的机器上跑不了，
 * 于是「Button 的 variant 写错、图标没从 barrel 导出、locale 键拼错」这类问题只能等到真机硬刷新
 * 才暴露。这里用 `renderToStaticMarkup`（SSR）把组件树跑一遍：`useEffect` 不执行，因此不会发请求，
 * 但 props 校验、组件导出、`t()` 的键是否存在全都会真实求值。
 *
 * 断言用 `locale.text(...)` 而不是写死中/英文：词典的 activeLocale 在测试进程里是默认语言，
 * 写死任何一种都会在切换语言时假红；`t('k')` 返回 undefined 时 `toContain` 会直接失败，
 * 这正好覆盖「键漏了」的情况。
 */
const t = locale.text

describe('扩展面板 tag 行', () => {
  it('四个标签页按「技能 / 插件 / 会话 / MCP」排序，重启控件在同一行的右侧（不再单开「服务」页）', () => {
    const html = renderToStaticMarkup(<ExtensionPanel createSkill={async () => {}} />)

    expect(html).toContain('role="tablist"')
    // 顺序是用户明确要求的，且 `rows[0]` 仍是技能（默认页不变）：按出现位置逐个递增断言。
    const order = ['skillsTab', 'pluginsTab', 'archiveTab', 'mcpTab'] as const
    let cursor = -1
    for (const key of order) {
      const at = html.indexOf(`>${t(key)}</button>`)
      expect(at, key).toBeGreaterThan(-1)
      expect(at, key).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(html).not.toContain(t('serviceTab'))

    // 重启控件：刷新 + 重启服务，且落在 tablist 之后（同一行、最右侧）
    expect(html).toContain('dshp-extension__head-actions')
    expect(html).toContain(t('restartNow'))
    expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('dshp-extension__head-actions'))

    // 首屏只挂载当前页的面板（visited 策略）
    expect(html.split('dshp-extension__tab-panel').length - 1).toBe(1)
  })

  it('没有未翻译的键泄漏成 undefined', () => {
    const html = renderToStaticMarkup(<ExtensionPanel createSkill={async () => {}} />)
    expect(html).not.toContain('undefined')
  })
})

describe('重启控件', () => {
  it('状态未知时（SSR 不跑 effect）如实渲染禁用态，并把「载入中」写进 title', () => {
    const html = renderToStaticMarkup(<RestartControl t={t} />)

    expect(html).toContain(t('restartNow'))
    // 不可重启时按钮禁用、原因挂在 title 上（鼠标悬停即可看到，不用点开）
    expect(html).toContain(t('loading'))
    expect(html).toContain('data-disabled="true"')
    // 禁用态 button 的 title 不一定弹，所以同时挂在外层不会禁用的 span 上
    expect(html).toContain('dshp-extension__tip')
    expect(html).toContain(`title="${t('loading')}"`)
    expect(html).not.toContain('undefined')
  })
})

describe('已归档页', () => {
  it('载入态就有标题、文字「刷新」按钮、全选与批量动作', () => {
    const html = renderToStaticMarkup(<ArchiveTab t={t} />)

    expect(html).toContain(t('archiveTitle'))
    expect(html).toContain(t('archiveSelectAll'))
    expect(html).toContain(t('archiveUnarchive'))
    expect(html).toContain(t('archiveCancelPending'))
    expect(html).toContain(t('loading'))
    // 刷新在这里是文字按钮（右上角重启控件已经占了一个刷新图标）
    expect(html).toContain(`data-prim="Button">${t('refresh')}<`)
    expect(html).not.toContain('undefined')
  })
})
