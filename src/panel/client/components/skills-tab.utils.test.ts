import { describe, expect, it } from 'vitest'
import { normalizeRepository, policyTag, sourceFamiliesOf, sourceFamilyOf } from './skills-tab.utils'

/**
 * 来源类别的纯逻辑。
 *
 * 为什么值得单独测：DSH 的 `source` 有四个「看起来一样」的值（`project-dsh` / `project-agents` /
 * `user-dsh` / `user-agents`），直接按值渲染就会出现两个同名的「用户」筛选标签。
 * 这里把「合并成类别」的映射钉死，顺便钉住「官方加新值时归到自定义」这条兜底。
 */
describe('sourceFamilyOf', () => {
  it('把两个用户来源并成一类，两个项目来源并成一类', () => {
    expect(sourceFamilyOf('user-dsh')).toBe('user')
    expect(sourceFamilyOf('user-agents')).toBe('user')
    expect(sourceFamilyOf('project-dsh')).toBe('project')
    expect(sourceFamilyOf('project-agents')).toBe('project')
  })

  it('其余来源各自成类', () => {
    expect(sourceFamilyOf('runtime')).toBe('runtime')
    expect(sourceFamilyOf('bundled')).toBe('bundled')
    expect(sourceFamilyOf('custom')).toBe('custom')
  })

  it('认不出的来源归到自定义，不要把机器值透到界面上', () => {
    expect(sourceFamilyOf('some-new-source')).toBe('custom')
    expect(sourceFamilyOf('')).toBe('custom')
  })
})

describe('sourceFamiliesOf', () => {
  it('去重并保持首次出现的顺序', () => {
    expect(sourceFamiliesOf([
      { source: 'user-agents' },
      { source: 'project-dsh' },
      { source: 'user-dsh' },
      { source: 'project-agents' },
    ] as never)).toEqual(['user', 'project'])
  })

  it('空列表给空数组（页面据此不渲染筛选行）', () => {
    expect(sourceFamiliesOf([])).toEqual([])
  })
})

describe('policyTag / normalizeRepository（既有口径，顺手钉住）', () => {
  it('两种调用位都关掉时标成停用', () => {
    expect(policyTag({ invocation: { modelInvocable: false, userInvocable: false } } as never)).toEqual({ key: 'skillDisabled', off: true })
    expect(policyTag({ invocation: { modelInvocable: true, userInvocable: true } } as never)).toEqual({ off: false })
  })

  it('仓库写法归一成 https URL，非 GitHub 的不认', () => {
    expect(normalizeRepository('functy23/dsh-mcp-studio')).toBe('https://github.com/functy23/dsh-mcp-studio')
    expect(normalizeRepository('https://github.com/a/b/')).toBe('https://github.com/a/b')
    expect(normalizeRepository('not a repo')).toBeNull()
  })
})
