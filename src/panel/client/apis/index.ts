/**
 * 面板 HTTP API 的手写封装（ofetch）。返回类型全部来自 `./index.type`，也就是 host 的
 * `routes/index.types.ts` —— 加/改字段时只需要改 host 一处，客户端自动跟上。
 *
 * 只保留真的有调用方的入口：没有消费方的包装函数（曾经有 mcp/copy、roots get/delete 三个）
 * 会让「接口存在」与「功能可用」两件事看起来一样，改起来还得先判断谁在用。
 */

import type { FetchOptions } from "dsh-tauri/client";
import { ofetch } from "dsh-tauri/client";
import type * as Types from "./index.type";

export const baseURL = "/dsh-toolshed/api";

/**
 * 带 code/blockers 的接口错误。
 *
 * 为什么不用默认的 `onResponseError`：它把错误压成一句 `请求失败 (409): ...`，
 * 页面需要靠 `code` / `blockers` 区分「被活跃会话挡住」「不是归档会话」「队列写不进去」，
 * 那句话里没有这些信息。只在会话管理/重启这几个入口上换用本错误。
 */
export class ApiError extends Error {
  status: number;
  code: string | undefined;
  blockers: Types.RestartBlockerView[] | undefined;

  constructor(status: number, message: string, code?: string, blockers?: Types.RestartBlockerView[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.blockers = blockers;
  }
}

/** 逐调用覆盖的错误钩子（ofetch 的 call-level 选项优先于实例 defaults）。 */
const jsonError = {
  onResponseError: ({ response }: { response: { status: number, _data?: unknown } }) => {
    const data = response._data as { error?: string, message?: string, code?: string, blockers?: Types.RestartBlockerView[] } | undefined;
    const message = data?.error ?? data?.message ?? `请求失败 (${response.status})`;
    throw new ApiError(response.status, message, data?.code, data?.blockers);
  },
} satisfies FetchOptions;

/** @method get */
export function getRestartStatus(options?: FetchOptions) {
  return ofetch<Types.RestartStatusResponse>("/host/restart", { baseURL, method: "get", ...options });
}

/** @method post */
export function postHostRestart(options?: FetchOptions) {
  return ofetch<Types.RestartLaunchResponse>("/host/restart", { baseURL, method: "post", ...jsonError, ...options });
}

/** @method get */
export function getArchived(options?: FetchOptions) {
  return ofetch<Types.ArchiveListResponse>("/archived", { baseURL, method: "get", ...jsonError, ...options });
}

/** @method post */
export function postArchivePlan(body: Types.ArchivePlanBody, options?: FetchOptions) {
  return ofetch<Types.ArchivePlanResponse>("/archive/plan", { baseURL, method: "post", body, ...jsonError, ...options });
}

/** @method delete */
export function deleteArchived(body: Types.ArchiveDeleteBody, options?: FetchOptions) {
  return ofetch<Types.ArchiveRemoveResponse>("/archive", { baseURL, method: "delete", body, ...jsonError, ...options });
}

/** @method post */
export function postArchiveUnarchive(body: Types.ArchiveCancelBody, options?: FetchOptions) {
  return ofetch<Types.ArchiveUnarchiveResponse>("/archive/unarchive", { baseURL, method: "post", body, ...jsonError, ...options });
}

/** @method post */
export function postArchivePendingCancel(body: Types.ArchiveCancelBody, options?: FetchOptions) {
  return ofetch<Types.ArchiveCancelResponse>("/archive/pending/cancel", { baseURL, method: "post", body, ...jsonError, ...options });
}

/** @method post */
export function postImportApply(body: Types.McpImportApplyBody, options?: FetchOptions) {
  return ofetch<Types.McpApplyImportResponse>("/import/apply", { baseURL, method: "post", body, ...options });
}

/** @method get */
export function getImportScan(options?: FetchOptions) {
  return ofetch<Types.McpImportScanResponse>("/import/scan", { baseURL, method: "get", ...options });
}

/** @method post */
export function postMcpCheck(body: Types.McpCheckBody, options?: FetchOptions) {
  return ofetch<Types.McpCheckResult>("/mcp/check", { baseURL, method: "post", body, ...options });
}

/** @method get */
export function getMcp(options?: FetchOptions) {
  return ofetch<Types.McpListResponse>("/mcp", { baseURL, method: "get", ...options });
}

/** @method post */
export function postMcp(body: Types.McpSaveBody, options?: FetchOptions) {
  return ofetch<Types.McpSaveResponse>("/mcp", { baseURL, method: "post", body, ...options });
}

/** @method delete */
export function deleteMcp(body: Types.McpRemoveBody, options?: FetchOptions) {
  return ofetch<Types.McpActionResult>("/mcp", { baseURL, method: "delete", body, ...options });
}

/** @method post */
export function postMcpToggle(body: Types.McpToggleBody, options?: FetchOptions) {
  return ofetch<Types.McpActionResult>("/mcp/toggle", { baseURL, method: "post", body, ...options });
}

/** @method post */
export function postOpenDir(body: Types.SkillOpenBody, options?: FetchOptions) {
  return ofetch<Types.ActionResult>("/open/dir", { baseURL, method: "post", body, ...options });
}

/** @method post */
export function postRoots(body: Types.RootAddBody, options?: FetchOptions) {
  return ofetch<Types.RootAddResponse>("/roots", { baseURL, method: "post", body, ...options });
}

/** @method get */
export function getSkill(params?: Types.GetSkillQuery, options?: FetchOptions) {
  return ofetch<Types.SkillContentResponse>("/skill", { baseURL, method: "get", params, ...options });
}

/** @method post */
export function postSkill(body: Types.SkillSaveBody, options?: FetchOptions) {
  return ofetch<Types.ActionResult>("/skill", { baseURL, method: "post", body, ...options });
}

/** @method delete */
export function deleteSkill(body: Types.SkillDeleteBody, options?: FetchOptions) {
  return ofetch<Types.ActionResult>("/skill", { baseURL, method: "delete", body, ...options });
}

/** @method post */
export function postSkillPolicy(body: Types.SkillPolicyBody, options?: FetchOptions) {
  return ofetch<Types.ActionResult>("/skill/policy", { baseURL, method: "post", body, ...options });
}

/** @method get */
export function getSkills(options?: FetchOptions) {
  return ofetch<Types.SkillsResponse>("/skills", { baseURL, method: "get", ...options });
}

/** @method post */
export function postSkillsRefresh(options?: FetchOptions) {
  return ofetch<Types.SkillsResponse>("/skills/refresh", { baseURL, method: "post", ...options });
}

/** @method get */
export function getPlugins(options?: FetchOptions) {
  return ofetch<Types.PluginsListResponse>("/plugins", { baseURL, method: "get", ...jsonError, ...options });
}

// `...jsonError` 是必需的：要靠 code 区分 409 `self-management` 与 503 `plugin-manager-unavailable`，
// 默认的 onResponseError 只留一句「请求失败 (409)」，页面无法给出可执行的下一步。
/** @method post */
export function postPluginBundleToggle(body: Types.PluginBundleToggleBody, options?: FetchOptions) {
  return ofetch<Types.PluginToggleResponse>("/plugins/bundle/toggle", { baseURL, method: "post", body, ...jsonError, ...options });
}

// 检查/安装同样要 `...jsonError`：503 `plugin-manager-unavailable` 是「这台机器没有插件管理」，
// 与「包名写错了」完全不是一件事，只能靠 code 分开，否则页面只能笼统地报「请求失败」。
/** @method post */
export function postPluginInspect(body: Types.PluginInspectBody, options?: FetchOptions) {
  return ofetch<Types.PluginInspectResponse>("/plugins/inspect", { baseURL, method: "post", body, ...jsonError, ...options });
}

/** @method post */
export function postPluginInstall(body: Types.PluginInstallBody, options?: FetchOptions) {
  return ofetch<Types.PluginInstallResponse>("/plugins/install", { baseURL, method: "post", body, ...jsonError, ...options });
}

/** @method post */
export function postPluginUpdateCheck(body: Types.PluginUpdateCheckBody, options?: FetchOptions) {
  return ofetch<Types.PluginUpdateCheckResponse>("/plugins/updates", { baseURL, method: "post", body, ...jsonError, ...options });
}

// 更新会真的卸旧版再装新版——失败原因（网络 / 权限 / 脚本未批准）必须能透出，所以同样带 `...jsonError`。
/** @method post */
export function postPluginUpdate(body: Types.PluginUpdateBody, options?: FetchOptions) {
  return ofetch<Types.PluginUpdateResponse>("/plugins/update", { baseURL, method: "post", body, ...jsonError, ...options });
}
/**
 * 卸载一个包：走官方 `removeBundle`（取消选中 → pnpm remove → reload）。
 * 失败原因（not-removable / stop-profile / bundle-in-use）要靠 `...jsonError` 透出机器码。
 * @method post
 */
export function postPluginRemove(body: Types.PluginRemoveBody, options?: FetchOptions) {
  return ofetch<Types.PluginRemoveResponse>("/plugins/remove", { baseURL, method: "post", body, ...jsonError, ...options });
}