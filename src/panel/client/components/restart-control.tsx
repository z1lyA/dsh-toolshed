import type { ReactElement } from 'react'
import type { RestartBlockerView, RestartStatusResponse } from '../apis/index.type'
import type { RestartControlProps } from './restart-control.types'
import { ArrowRotateRight, Button, Icon, IconButton, Modal } from 'dsh-tauri-ui/client'
import { useEffect, useState } from 'react'
import { ApiError, getRestartStatus } from '../apis'
import { SERVICE_RESTART_INITIAL_DELAY_MS, SERVICE_RESTART_POLL_INTERVAL_MS, SERVICE_RESTART_TIMEOUT_MS } from '../constants'
import { useTimers } from '../hooks/use-timers'
import { restartHost } from '../service/restart'

/**
 * 标签页行最右侧的重启控件（刷新 + 重启服务）。
 *
 * 为什么不再单开一个「服务」tab：重启是宿主级、低频的动作，占一整页太重。
 * 这里只保留两个按钮：
 *   - 刷新：重新拉 `GET /api/host/restart`，重新判断现在能不能重启；
 *   - 重启服务：**不可重启时禁用**，`title` 直接说明原因（有会话在跑 / 排队输入 / 后台任务 /
 *     不是桌面应用），鼠标悬停即可看到，不需要用户先点开再看错误。
 *
 * 点击重启仍走一次确认弹窗：它会中断正在跑的回合，误触的代价太大。确认后才真正发起，
 * 并在宿主恢复后自动整页重载（重启必然切断这次请求）。
 */
export function RestartControl({ t }: RestartControlProps): ReactElement {
  const [status, setStatus] = useState<RestartStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mounted, later } = useTimers()

  const kindLabel = (kind: RestartBlockerView['kind']): string => {
    if (kind === 'running')
      return t('serviceBlockerRunning')
    return kind === 'queued' ? t('serviceBlockerQueued') : t('serviceBlockerJob')
  }

  const load = (): void => {
    setBusy(true)
    void getRestartStatus().then(
      (body) => {
        if (mounted.current)
          setStatus(body)
      },
      (cause: unknown) => {
        if (mounted.current)
          setStatus(null) // 读不到状态就当作「不可重启」，按钮保持禁用而不是放行
        void cause
      },
    ).finally(() => {
      if (mounted.current)
        setBusy(false)
    })
  }

  useEffect(() => {
    load()
    // 只在挂载时探一次：`visited` 策略让标签页常驻，定时轮询会在隐藏时白跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const available = status?.restartAvailable === true
  const canRestart = status?.canRestart === true
  const blockers = status?.blockers ?? []
  const disabled = busy || restarting || !available || !canRestart

  /** 一句话概述原因（不列 id）：tooltip 只回答「为什么现在不能重启」。 */
  const blockedSummary = (): string =>
    `${t('restartBlocked')}: ${[...new Set(blockers.map(blocker => blocker.kind))].map(kindLabel).join(', ')}`

  const hint = status === null
    ? t('loading')
    : !available
        ? t('serviceOnlyDesktop')
        : canRestart ? t('serviceReady') : blockedSummary()

  /**
   * 失败原因要能直接指导下一步，而不是甩一句原始英文错误。
   *
   * - `restart-blocked`：用同一句话概述"被哪些工作挡住"（与按钮的 tooltip 一致）；
   * - `restart-unavailable`：宿主明确拒绝（不在桌面应用 / 助手文件缺失 / 路径含 `%`），
   *   消息本身就是可执行的说明，前面加一句"无法重启"；
   * - 其它：保留 `code`/状态码，方便贴到 issue 里定位。
   */
  const failureText = (cause: unknown): string => {
    if (cause instanceof ApiError) {
      if (cause.code === 'restart-blocked')
        return blockedSummary() || t('restartBlocked')
      if (cause.code === 'restart-unavailable')
        return `${t('restartBlocked')}: ${cause.message}`
      const code = cause.code ?? `HTTP ${cause.status}`
      return `${t('failed')}: ${cause.message} (${code})`
    }
    return `${t('failed')}: ${cause instanceof Error ? cause.message : String(cause)}`
  }

  const doRestart = (): void => {
    setError(null)
    setBusy(true)
    void restartHost().then(
      () => {
        if (!mounted.current)
          return
        setBusy(false)
        setConfirm(false)
        setRestarting(true)
        pollRecovery()
      },
      (cause: unknown) => {
        if (!mounted.current)
          return
        setBusy(false)
        setError(failureText(cause))
        load()
      },
    )
  }

  /** 重启后轮询到宿主恢复，再整页重载；连不上就当「还没起来」继续等。 */
  const pollRecovery = (): void => {
    const deadline = Date.now() + SERVICE_RESTART_TIMEOUT_MS
    const tick = (): void => {
      if (!mounted.current || Date.now() > deadline)
        return
      later(() => {
        void getRestartStatus().then(
          () => { window.location.reload() },
          () => { tick() },
        )
      }, SERVICE_RESTART_POLL_INTERVAL_MS)
    }
    later(tick, SERVICE_RESTART_INITIAL_DELAY_MS)
  }

  return (
    <span className="dshp-extension__head-actions">
      <IconButton
        variant="toolbar"
        icon={<Icon as={ArrowRotateRight} />}
        aria-label={t('refresh')}
        title={t('refresh')}
        disabled={busy || restarting}
        onClick={load}
      />
      {/*
        禁用态的 <button> 在 Chromium 里收不到鼠标事件，title 也常常不弹。
        title 同时挂在不会禁用的外层 span 上，保证「为什么不能重启」悬停一定能看到。
      */}
      <span className="dshp-extension__tip" title={hint}>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={hint}
          aria-label={t('restartNow')}
          onClick={() => setConfirm(true)}
        >
          {restarting ? t('restarting') : t('restartNow')}
        </Button>
      </span>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        closeLabel={t('close')}
        title={t('restartConfirmTitle')}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => doRestart()}>{t('restartNow')}</Button>
          </>
        )}
      >
        <p>{t('restartConfirmBody')}</p>
        {error !== null && <p className="dshp-extension__form-error">{error}</p>}
      </Modal>
    </span>
  )
}
