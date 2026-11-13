import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionPanelFeature } from './extension-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'

/**
 * 面板注册链的集成测试：`defineRegister` → `definePanel` → 槽位注册 → 渲染。
 *
 * 为什么需要（浏览器验收之外唯一能自动化的环节）：渲染测试只覆盖了组件树，
 * 「侧栏入口注册到哪个槽、用什么 id/order、主区页面用什么 key、卸载时是否真的摘掉」
 * 这些正是真机才暴露的东西。这里用最小 fake ctx 把注册链跑一遍，并用 SSR 渲染出主区页面。
 */
function createCtx(): {
  ctx: any
  registrations: Array<{ slot: string, options: any, render: any, disposed: boolean }>
  layouts: Array<string | null>
} {
  const registrations: Array<{ slot: string, options: any, render: any, disposed: boolean }> = []
  const layouts: Array<string | null> = []
  const ctx: any = {
    // readMarket 靠 reflect 探测市场服务；没有 reflect 就是「未安装」
    reflect: undefined,
    slots: {
      inject(_name: string, callback: () => unknown) {
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options: any, render: any) {
        const entry = { slot: String(options.name), options, render, disposed: false }
        registrations.push(entry)
        return () => {
          entry.disposed = true
          const index = registrations.indexOf(entry)
          if (index >= 0)
            registrations.splice(index, 1)
        }
      },
      entriesOfSlot(name: string) {
        return registrations.filter(entry => entry.slot === name)
      },
    },
    layout: {
      selectPanel(id: string | null) {
        layouts.push(id)
      },
    },
    inject(_names: string[], callback: () => unknown) {
      return typeof callback === 'function' ? callback() : undefined
    },
    effect(setup: () => unknown) {
      return setup()
    },
  }
  return { ctx, registrations, layouts }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('扩展面板注册链', () => {
  it('注册一个侧栏入口 + 一个主区页面，id/order/locale 与常量一致', () => {
    const { ctx, registrations } = createCtx()

    const dispose = extensionPanelFeature.call(ctx)
    try {
      const sidebar = registrations.find(entry => entry.slot === 'sidebar.panellist')
      const main = registrations.find(entry => entry.slot === 'main')
      expect(sidebar).toBeDefined()
      expect(main).toBeDefined()

      expect(sidebar!.options).toMatchObject({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ACTION_ORDER, registrant: PANEL_ID })
      expect(main!.options).toMatchObject({ name: 'main', key: PANEL_ID, locale: locale.NS, registrant: PANEL_ID })
      // 侧栏文案是函数：语言切换后重新求值
      expect(typeof sidebar!.options.label).toBe('function')
      expect(sidebar!.options.label()).toBe(locale.text('extension'))
    }
    finally {
      dispose()
    }
  })

  it('主区页面渲染出四个常驻 tab（无市场时不出现市场页）', () => {
    const { ctx, registrations } = createCtx()
    const dispose = extensionPanelFeature.call(ctx)
    try {
      const main = registrations.find(entry => entry.slot === 'main')!
      const html = renderToStaticMarkup(main.render() as ReactElement)

      expect(html).toContain('dshp-panel-page')
      expect(html).toContain('role="tablist"')
      for (const key of ['skillsTab', 'mcpTab', 'archiveTab', 'serviceTab'] as const)
        expect(html, key).toContain(locale.text(key))
      expect(html).not.toContain(locale.text('marketTab'))
    }
    finally {
      dispose()
    }
  })

  it('effect 的 disposer 摘掉两个槽位注册（卸载后不留悬浮入口）', () => {
    const { ctx, registrations } = createCtx()
    const dispose = extensionPanelFeature.call(ctx)
    expect(registrations).toHaveLength(2)

    dispose()
    expect(registrations).toHaveLength(0)
  })
})
