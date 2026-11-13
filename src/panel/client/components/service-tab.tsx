import type { ReactElement } from 'react'
import type { RestartStatusResponse } from '../apis/index.type'
import type { ServiceTabProps } from './service-tab.types'
import { ArrowRotateRight, Button, Icon, IconButton, Modal, StateDot } from 'dsh-tauri-ui/client'
import { useEffect, useState } from 'react'
import { ApiError, getRestartStatus } from '../apis'
import { SERVICE_RESTART_INITIAL_DELAY_MS, SERVICE_RESTART_POLL_INTERVAL_MS, SERVICE_RESTART_TIMEOUT_MS } from '../constants'
import { useTimers } from '../hooks/use-timers'
import { restartHost } from '../service/restart'

/**
 * 「服务」tab：一个页面只干一件事——安全地重启 DSH 宿主。
 *
 * 为什么单独成页而不是 MCP 页里的一个按钮：重启是宿主级动作，被它挡住的原因
 * （运行中会话 / 排队输入 / 后台任务）需要完整列出来；MCP 页只保留「配置已写入，
 * 需要重启」的提示，并把动作转到这一页，不再有第二个重启入口。
 *
 * 进入时拉一次状态 + 手动刷新，不做定时轮询：`visited` 策略让访问过的 tab 常驻挂载，
 * 定时器会在隐藏页里空转。
 */
export function ServiceTab({ t }: ServiceTabProps): ReactElement {
  const [status, setStatus] = useState<RestartStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean, text: string } | null>(null)
  const [reload, setReload] = useState(0)
  const { mounted, later } = useTimers()

  useEffect(() => {
    let current = true
    setBusy(true)
    void getRestartStatus().then(
      (body) => {
        if (current)
          setStatus(body)
      },
      (error: unknown) => {
        if (current)
          setOutcome({ ok: false, text: `${t('failed')}: ${error instanceof Error ? error.message : String(error)}` })
      },
    ).finally(() => {
      if (current)
        setBusy(false)
    })
    return () => {
      current = false
    }
  }, [reload, t])

  const blockerLabel = (kind: string): string => {
    if (kind === 'running')
      return t('serviceBlockerRunning')
    if (kind === 'queued')
      return t('serviceBlockerQueued')
    return t('serviceBlockerJob')
  }

  const doRestart = (): void => {
    setConfirm(false)
    setBusy(true)
    setOutcome(null)
    void restartHost().then(
      () => {
        setRestarting(true)
        setBusy(false)
        pollRecovery()
      },
      (error: unknown) => {
        setBusy(false)
        if (error instanceof ApiError && Array.isArray(error.blockers) && error.blockers.length > 0) {
          setOutcome({ ok: false, text: `${t('restartBlocked')}: ${error.blockers.map(item => `${blockerLabel(item.kind)} ${item.id}`).join(', ')}` })
          setReload(value => value + 1)
          return
        }
        setOutcome({ ok: false, text: `${t('failed')}: ${error instanceof Error ? error.message : String(error)}` })
        setReload(value => value + 1)
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

  const available = status?.restartAvailable === true
  const canRestart = status?.canRestart === true
  const blockers = status?.blockers ?? []

  return (
    <div className="dshp-extension__section">
      <div className="dshp-extension__head">
        <span className="dshp-extension__head-icon"><Icon as={ArrowRotateRight} size={16} /></span>
        <h3>{t('serviceTitle')}</h3>
        <span className="dshp-extension__spacer" />
        <IconButton
          variant="toolbar"
          icon={<Icon as={ArrowRotateRight} />}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={busy || restarting}
          onClick={() => setReload(value => value + 1)}
        />
        <Button variant="ghost" size="sm" disabled={busy || restarting || !available || !canRestart} onClick={() => setConfirm(true)}>
          {restarting ? t('restarting') : t('restartNow')}
        </Button>
      </div>
      <p className="dshp-extension__intro">{t('serviceIntro')}</p>

      {outcome !== null && (
        <div className="dshp-extension__banner" data-kind={outcome.ok ? 'ok' : 'error'} role="status">
          <StateDot state={outcome.ok ? 'done' : 'error'} size={10} />
          <div className="dshp-extension__banner-body">{outcome.text}</div>
        </div>
      )}

      {restarting && (
        <div className="dshp-extension__banner" data-kind="info" role="status">
          <StateDot state="ongoing" size={10} />
          <div className="dshp-extension__banner-body">
            <span>{t('restarting')}</span>
            <span className="dshp-extension__banner-hint">{t('restartPortHint')}</span>
          </div>
        </div>
      )}

      {status === null && <p className="dshp-extension__empty">{t('loading')}</p>}

      {status !== null && (
        <ul className="dshp-extension__sessions">
          <li className="dshp-extension__session">
            <div className="dshp-extension__session-body">
              <strong className="dshp-extension__session-title">
                {available ? (canRestart ? t('serviceReady') : t('serviceBlockedTitle')) : t('serviceUnavailable')}
              </strong>
              <div className="dshp-extension__session-meta">
                <span>{t('serviceHostLabel')}</span>
                <span>{available ? t('serviceHostDesktop') : t('serviceHostOther')}</span>
              </div>
              {available && !canRestart && (
                <ul className="dshp-extension__blockers">
                  {blockers.map(item => <li key={`${item.kind}:${item.id}`}>{blockerLabel(item.kind)} · {item.id}</li>)}
                </ul>
              )}
              {available && canRestart && <p className="dshp-extension__intro">{t('serviceNoBlockers')}</p>}
              {!available && <p className="dshp-extension__form-error">{t('serviceOnlyDesktop')}</p>}
            </div>
          </li>
          {status.logFile !== undefined && (
            <li className="dshp-extension__session">
              <div className="dshp-extension__session-body">
                <strong className="dshp-extension__session-title">{t('serviceLogPath')}</strong>
                <div className="dshp-extension__session-meta"><code>{status.logFile}</code></div>
              </div>
            </li>
          )}
        </ul>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        closeLabel={t('close')}
        title={t('restartConfirmTitle')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={doRestart}>{t('restartNow')}</Button>
          </>
        )}
      >
        <p>{t('restartConfirmBody')}</p>
      </Modal>
    </div>
  )
}
