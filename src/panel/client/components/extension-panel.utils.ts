/**
 * client/components/extension-panel.utils.ts — 扩展面板标签页的取舍判据。
 *
 * 标签页集合可能随运行时变化（例如某个标签页依赖的服务被别的插件撤下/重新发布）。
 * `useState` 的初值只取一次，若活动页直接沿用请求值，过滤结果为空——一行都不渲染，
 * 面板变成空白页（issue #655）。
 */

/**
 * 活动标签页：请求值仍在场就保持它，否则回落到首个现存标签页。
 * @param rows - 当前可用的标签页（市场页缺席时不在其中）。
 * @param requested - 用户最后选中的标签页 id。
 */
export function resolveActiveTab(rows: readonly { id: string }[], requested: string): string {
  return rows.some(row => row.id === requested) ? requested : rows[0]?.id ?? requested
}
