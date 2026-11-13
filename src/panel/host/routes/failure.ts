/**
 * 已归档会话 / 重启路由的失败映射。
 *
 * 为什么单独一层：`ArchiveRequestError.code` 是稳定的机器码，页面靠它区分
 * 「不是归档会话」「队列写不进去」「被活跃会话挡住」；把映射写在这里，四个 handler
 * 只负责取 body 和调服务。
 */
import type { H3Event } from 'h3'
import { ArchiveRequestError } from '../service/archive'

/** code → HTTP 状态。没列出的都按 500 处理（服务内部失败）。 */
function statusOf(code: string): number {
  switch (code) {
    case 'invalid-request':
    case 'invalid-id':
    case 'invalid-json':
      return 400
    case 'too-many':
    case 'body-too-large':
      return 413
    case 'restart-blocked':
      return 409
    case 'registry-unavailable':
    case 'persistence-unavailable':
    case 'restart-unavailable':
    case 'queue-unavailable':
    case 'queue-write-failed':
      return 503
    default:
      return 500
  }
}

/**
 * 把抛出值映射成 { status, body }。
 *
 * 返回体保持 mcp-studio 的错误形状（`{ error }`），并额外带上 `code` 与可选的 `blockers`
 * 供页面分支；`event.res.status` 由 h3 原样带到响应上。
 */
export function failure(
  event: H3Event,
  error: unknown,
): { error: string, code: string, blockers?: unknown } {
  const code = error instanceof ArchiveRequestError ? error.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  event.res.status = statusOf(code)
  const payload: { error: string, code: string, blockers?: unknown } = { error: message, code }
  if (Array.isArray((error as { blockers?: unknown })?.blockers))
    payload.blockers = (error as { blockers: unknown }).blockers
  return payload
}
