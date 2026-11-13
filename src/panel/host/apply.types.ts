/**
 * 插件行配置。
 *
 * `profile` 是上游就有的（Tauri 壳传 `--profile`，Web/Desktop 靠 profile 探测补）；
 * 其余键是已归档会话管理带来的：根目录覆盖给非标准部署用，`cleanupAttachmentsDefault`
 * 控制删除对话框中「同时清理未引用附件」的默认勾选状态。
 */
export interface Config {
  profile?: string
  /** DSH 主目录；缺省 `$DSH_HOME`，再缺省 `~/.dsh`。 */
  dshHome?: string
  /** 会话日志根；缺省 `<dshHome>/sessions`。 */
  sessionsRoot?: string
  /** JSON 存储根；缺省 `<dshHome>/storages`。 */
  storagesRoot?: string
  /** 附件根；缺省 `<dshHome>/attachments/v1`。 */
  attachmentsRoot?: string
  /** 删除时是否默认清理未引用附件（默认 true）。 */
  cleanupAttachmentsDefault?: boolean
}
