import type { ReactNode } from 'react'

/**
 * `@deepseek-ai/dsh-client-ui-primitives` 的测试替身（**只**给 vitest 用，构建期仍然 external）。
 *
 * 为什么需要：本包把官方 UI 包声明为 host-provided（AGENTS 约束 4），所以它既不在 dependencies
 * 里、也不会被打进产物；但 vitest 解析的是真实模块图，渲染 `Button` / `Tag` / `Modal` 时就会
 * `Cannot find package`。这里给出最小可渲染替身，让组件层能在进场前被跑一遍（见
 * `extension-panel.render.test.tsx`）。
 *
 * 组件的替身保留 `children`，因此「按钮文案、tab 标签、弹窗标题」这些文本断言仍然有效；
 * 其余转发值（`fileSizeText`、`relativeTime` …）只作为占位，保证 `official.tsx` 的
 * `export { … } from` 能通过链接期校验。
 */
const component = (name: string) => {
  const Stub = (props: { children?: ReactNode }) => <span data-prim={name}>{props?.children}</span>
  Stub.displayName = `Stub(${name})`
  return Stub
}

export const Button = component('Button')
export const Tag = component('Tag')
export const Input = component('Input')
export const Menu = component('Menu')
export const Modal = component('Modal')
export const Pill = component('Pill')
export const Switch = component('Switch')
export const StateDot = component('StateDot')
export const CodeBlock = component('CodeBlock')
export const ConnectionIndicator = component('ConnectionIndicator')
export const DiffBlock = component('DiffBlock')
export const DisclosureRow = component('DisclosureRow')
export const FileTypeIcon = component('FileTypeIcon')
export const FishLogo = component('FishLogo')
export const BrandWordmark = component('BrandWordmark')
export const HoverCard = component('HoverCard')
export const JsonBlock = component('JsonBlock')
export const JsonTree = component('JsonTree')
export const MarkdownText = component('MarkdownText')
export const ReadBlock = component('ReadBlock')
export const RiskConfirmation = component('RiskConfirmation')
export const SearchBlock = component('SearchBlock')
export const TerminalBlock = component('TerminalBlock')
export const Toast = component('Toast')
export const Tooltip = component('Tooltip')
export const WebBlock = component('WebBlock')

export const DEFAULT_DIFF_MAX_LINES = 100
export const DEFAULT_READ_MAX_LINES = 100
export const DEFAULT_SEARCH_MAX_LINES = 100
export const DEFAULT_TERMINAL_MAX_LINES = 100
export const FISH_LOGO_PATH = ''
export const FISH_LOGO_VIEWBOX = '0 0 1 1'

export const classifyFileType = (): string => 'text'
export const classifyLinkPath = (): string => 'text'
export const diffTotals = (): { additions: number, deletions: number } => ({ additions: 0, deletions: 0 })
export const extractMarkdownPlainText = (text: string): string => text
export const fileExtension = (): string => ''
export const fileSizeText = (bytes: number): string => `${bytes} B`
export const projectUserText = (text: string): string => text
export const rankByName = <T,>(items: T[]): T[] => items
export const relativeTime = (): string => ''
export const writeClipboard = async (): Promise<void> => {}
