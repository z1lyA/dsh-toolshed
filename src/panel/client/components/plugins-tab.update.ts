import type { PluginBundleView, PluginUpdateCheckView } from '../apis/index.type'

/**
 * 「检查更新」的纯逻辑。
 *
 * 为什么单独一层：排序、徽标、缓存新鲜度都是**决定**而不是描边，而组件里既跑不了 SSR 断言也不好测
 * ——放进这里就能像 `sidebar-tweaks` 那样用最小数据钉住。尤其是排序：`Array.prototype.sort` 在
 * 现代 V8 里是稳定的，但「稳定」靠的是调用方不制造并列以外的不确定，这里显式只在必要时返回 ±1。
 */

/** 需要检查更新的包名：只有 `update === 'registry'` 的能按版本号更新。 */
export function registryUpdatableOf(bundles: readonly PluginBundleView[]): string[] {
  const names: string[] = []
  for (const bundle of bundles) {
    if (bundle.update === 'registry' && bundle.name !== '' && !names.includes(bundle.name))
      names.push(bundle.name)
  }
  return names
}

/** 这一包有没有可装的更新（有 `latest` 才算）。 */
export function updateTargetOf(check: PluginUpdateCheckView | undefined): string | undefined {
  if (check === undefined || check.status !== 'listed')
    return undefined
  const version = check.latest?.version
  return typeof version === 'string' && version !== '' ? version : undefined
}

/**
 * 卡片徽标的数据：`0.6.4 → 0.6.5`。
 *
 * 当前版本取宿主报的 `bundle.version`（不是检查结果的 `installed`：后者是检查那一刻的视角，
 * 包刚被别处改过时两者会不一致，而卡片上显示的是**现在这一行**）。
 */
export function updateBadgeOf(
  bundle: PluginBundleView,
  check: PluginUpdateCheckView | undefined,
): { from?: string, to: string } | undefined {
  const to = updateTargetOf(check)
  if (to === undefined)
    return undefined
  const from = bundle.version
  return typeof from === 'string' && from !== '' ? { from, to } : { to }
}

/**
 * 把有更新的包排到最前。
 *
 * 只在**整批检查结束之后**调用一次（用户定稿：不要边到货边挪），其余包保持宿主给的顺序
 * （第三方 → 官方 → 包名）。
 */
export function sortBundlesByUpdate(
  bundles: readonly PluginBundleView[],
  checks: Readonly<Record<string, PluginUpdateCheckView>>,
): PluginBundleView[] {
  const updated: PluginBundleView[] = []
  const rest: PluginBundleView[] = []
  for (const bundle of bundles) {
    if (updateTargetOf(checks[bundle.name]) === undefined)
      rest.push(bundle)
    else
      updated.push(bundle)
  }
  return updated.length === 0 ? [...bundles] : [...updated, ...rest]
}

/** 缓存是否还能用：没查过 / 超过 TTL 都算过期。 */
export function isCheckStale(checkedAt: number | undefined, now: number, ttlMs: number): boolean {
  if (checkedAt === undefined)
    return true
  // 时钟回拨（`now < checkedAt`）也当作过期重查，而不是永远命中一份「来自未来」的缓存。
  return now - checkedAt >= ttlMs || now < checkedAt
}

/** 这批检查里有多少个包有可用更新（顶部状态的数字）。 */
export function updatedCountOf(checks: Readonly<Record<string, PluginUpdateCheckView>>, names: readonly string[]): number {
  let count = 0
  for (const name of names) {
    if (updateTargetOf(checks[name]) !== undefined)
      count += 1
  }
  return count
}
