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

  const blockerLabel = (blocker: RestartBlockerView): string => {
    const kind = blocker.kind === 'running'
      ? t('serviceBlockerRunning')
      : blocker.kind === 'queued' ? t('serviceBlockerQueued') : t('serviceBlockerJob')
    return `${kind} ${blocker.id}`
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

  const hint = status === null
    ? t('loading')
    : !available
        ? t('serviceOnlyDesktop')
        : canRestart ? t('serviceReady') : `${t('restartBlocked')}: ${blockers.map(blockerLabel).join(', ')}`

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
        setError(cause instanceof ApiError ? cause.message : `${t('failed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
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
