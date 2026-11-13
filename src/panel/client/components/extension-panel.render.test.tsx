import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { ArchiveTab } from './archive-tab'
import { ExtensionPanel } from './extension-panel'
import { ServiceTab } from './service-tab'

/**
 * tab 行与新增两页的渲染冒烟。
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

describe('扩展面板 tab 行', () => {
  it('四个常驻 tab 都在，市场缺席时不出现「市场」', () => {
    const html = renderToStaticMarkup(<ExtensionPanel createSkill={async () => {}} market={undefined} />)

    expect(html).toContain('role="tablist"')
    for (const key of ['skillsTab', 'mcpTab', 'archiveTab', 'serviceTab'] as const)
      expect(html, key).toContain(t(key))
    expect(html).not.toContain(t('marketTab'))

    // ARIA 约定：tab 按钮 id 与面板 id 共用一个后缀；首屏只挂载当前页的面板
    // （「访问过才常驻挂载」的 visited 策略 → 初始只有 skills 一个 panel div）。
    expect(html).toContain('-archive"')
    expect(html).toContain('-service"')
    expect(html).toContain('-skills-panel"')
    expect(html.split('dshp-extension__tab-panel').length - 1).toBe(1)
  })

  it('没有未翻译的键泄漏成 undefined', () => {
    const html = renderToStaticMarkup(<ExtensionPanel createSkill={async () => {}} market={undefined} />)
    expect(html).not.toContain('undefined')
  })
})

describe('已归档页', () => {
  it('载入态就有标题、全选与批量动作', () => {
    const html = renderToStaticMarkup(<ArchiveTab t={t} onNavigate={() => {}} />)

    expect(html).toContain(t('archiveTitle'))
    expect(html).toContain(t('archiveSelectAll'))
    expect(html).toContain(t('archiveUnarchive'))
    expect(html).toContain(t('archiveCancelPending'))
    expect(html).toContain(t('loading'))
    expect(html).not.toContain('undefined')
  })
})

describe('服务页', () => {
  it('载入态有标题、重启按钮与日志/形态说明，且没有重复的重启入口', () => {
    const html = renderToStaticMarkup(<ServiceTab t={t} />)

    expect(html).toContain(t('serviceTitle'))
    expect(html).toContain(t('serviceIntro'))
    expect(html).toContain(t('restartNow'))
    expect(html).toContain(t('loading'))
    expect(html).not.toContain('undefined')
    // 服务页只出现一次重启按钮文案（确认没顺手再塞一个入口进来）。
    expect(html.split(t('restartNow')).length - 1).toBe(1)
  })
})
