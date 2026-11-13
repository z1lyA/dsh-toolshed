/**
 * client/components/extension-panel.utils.test.ts — 活动标签页必须落在现存标签页上。
 *
 * 守一条事故约束（issue #655）：标签页集合可能随运行时变化（某个标签页依赖的服务被别的插件
 * 撤下/重新发布）。活动页若仍是那个已不存在的 id，面板过滤后一行都不渲染——面板变成空白页，
 * 且不会自愈。
 */

import { describe, expect, it } from 'vitest'
import { resolveActiveTab } from './extension-panel.utils'

const OPTIONAL_PRESENT = [{ id: 'optional' }, { id: 'skills' }, { id: 'mcp' }]
const OPTIONAL_ABSENT = [{ id: 'skills' }, { id: 'mcp' }]

describe('resolveActiveTab', () => {
  it('请求的标签页仍在场：原样保持，不跳回第一页', () => {
    expect(resolveActiveTab(OPTIONAL_PRESENT, 'mcp')).toBe('mcp')
  })

  it('请求的标签页已消失：回落到首个现存标签页，而不是留一个不存在的活动页', () => {
    expect(resolveActiveTab(OPTIONAL_ABSENT, 'optional')).toBe('skills')
  })

  it('只剩一个标签页时回落到它', () => {
    expect(resolveActiveTab([{ id: 'skills' }], 'optional')).toBe('skills')
  })

  it('没有任何标签页：返回请求值，不返回 undefined', () => {
    expect(resolveActiveTab([], 'optional')).toBe('optional')
  })
})
