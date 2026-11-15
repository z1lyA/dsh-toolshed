import type { LocaleKey } from '../locales/index.types'
import type { SkillRowView } from '../types'
import { GITHUB_REPOSITORY_PATTERN } from '../constants'

/**
 * 技能来源 → 展示类别。
 *
 * 为什么要把 `*-dsh` 与 `*-agents` 并成同一类：这是两个**并存**的扫描根目录
 * （`~/.dsh/skills` 与 `~/.agents/skills`，项目级同理），DSH 把它们的 `source` 分成四个值，
 * 而中文都叫「项目 / 用户」——直接按 `source` 渲染筛选项就会出现两个同名标签，看着像重复。
 * 类别只回答「这技能属于谁 / 从哪来」，不再区分具体是哪个约定目录。
 */
export const SOURCE_FAMILIES: Readonly<Record<string, string>> = {
  'project-dsh': 'project',
  'project-agents': 'project',
  'user-dsh': 'user',
  'user-agents': 'user',
  'runtime': 'runtime',
  'bundled': 'bundled',
  'custom': 'custom',
}

/** 来源类别 → 文案键。未知来源一律落到「自定义」。 */
export const SOURCE_FAMILY_LOCALE_KEYS: Readonly<Record<string, LocaleKey>> = {
  project: 'sourceProject',
  user: 'sourceUser',
  runtime: 'sourceRuntime',
  bundled: 'sourceBundled',
  custom: 'sourceCustom',
}

/**
 * 一个 `source` 属于哪个类别。
 *
 * 认不出的值也归「自定义」而不是原样显示：`source` 是宿主字段，官方加新值时宁可归一类，
 * 也不要在筛选里冒出一个英文机器值。
 */
export function sourceFamilyOf(source: string): string {
  return SOURCE_FAMILIES[source] ?? 'custom'
}

/** 这批技能出现了哪些类别（保持首次出现顺序，供筛选 chips 使用）。 */
export function sourceFamiliesOf(skills: readonly SkillRowView[]): string[] {
  const families: string[] = []
  for (const skill of skills) {
    const family = sourceFamilyOf(skill.source)
    if (!families.includes(family))
      families.push(family)
  }
  return families
}

export function policyTag(skill: SkillRowView): { key?: LocaleKey, off: boolean } {
  const { modelInvocable, userInvocable } = skill.invocation
  if (!modelInvocable && !userInvocable)
    return { key: 'skillDisabled', off: true }
  if (!modelInvocable)
    return { key: 'skillUserOnly', off: false }
  if (!userInvocable)
    return { key: 'skillModelOnly', off: false }
  return { off: false }
}

export function normalizeRepository(value: string): string | null {
  const normalized = value.trim().replace(/\/$/, '')
  if (!GITHUB_REPOSITORY_PATTERN.test(normalized))
    return null
  return normalized.startsWith('http') ? normalized : `https://github.com/${normalized}`
}
