import type { ReactElement } from 'react'
import type { ArchivePlanResponse, ArchiveRemoveResponse, ArchivedSessionView } from '../apis/index.type'
import type { ArchiveFailureLine, ArchiveTabProps } from './archive-tab.types'
import { ArrowRotateRight, Button, Checkbox, Icon, IconButton, Modal, StateDot, Tag, Tray } from 'dsh-tauri-ui/client'
import { useEffect, useMemo, useState } from 'react'
import { deleteArchived, getArchived, postArchivePendingCancel, postArchivePlan, postArchiveUnarchive } from '../apis'
import { useTimers } from '../hooks/use-timers'

/** 体积的可读化（B/KB/MB/GB/TB；0–1 位小数，与宿主的 fileSizeText 语义一致但不受其精度约束）。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** exponent)
  const digits = exponent === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[exponent]}`
}

/** 会话 id 在行首展示时截断，完整值留在 title 上。 */
function shortId(id: string): string {
  return id.length <= 18 ? id : `${id.slice(0, 8)}…${id.slice(-6)}`
}

/**
 * 「已归档」tab：DSH 没有删除会话的接口，这里补上，并把边界条件显式化。
 *
 * 关键交互规则（与宿主服务一一对应）：
 *  - 只有归档会话能被选中；取消归档会同时撤掉它的「待删除」意图；
 *  - 删除先走 dry-run 计划（`/archive/plan`），弹窗里分「立即删 / 排队 / 拒绝」三类；
 *  - live 会话不会被强删，只登记为「待删除」，下次启动 DSH 时执行；
 *  - 有排队条目时只提示「去服务页重启」，不在这一页再放一个重启按钮。
 */
export function ArchiveTab({ t, onNavigate }: ArchiveTabProps): ReactElement {
  const [rows, setRows] = useState<ArchivedSessionView[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [outcome, setOutcome] = useState<{ ok: boolean, text: string } | null>(null)
  const [failures, setFailures] = useState<ArchiveFailureLine[]>([])
  const [plan, setPlan] = useState<ArchivePlanResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [cleanupAttachments, setCleanupAttachments] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  const { mounted } = useTimers()

  useEffect(() => {
    let current = true
    setBusy(true)
    void getArchived().then(
      (body) => {
        if (!current)
          return
        setRows(body.items)
        setCleanupAttachments(body.defaults.cleanupAttachments)
      },
      (error: unknown) => {
        if (!current)
          return
        setRows([])
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

  /** 选中集合按「当前仍存在的行」收敛：刷新后消失的行不该继续占着选择。 */
  const selectable = useMemo(() => (rows ?? []).map(row => row.id), [rows])
  const selectedIds = useMemo(() => selectable.filter(id => selected.has(id)), [selectable, selected])
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length
  const pendingSelected = useMemo(
    () => (rows ?? []).filter(row => selected.has(row.id) && row.pending !== undefined).map(row => row.id),
    [rows, selected],
  )

  const toggleOne = (id: string, next: boolean): void => {
    setSelected((previous) => {
      const draft = new Set(previous)
      if (next)
        draft.add(id)
      else
        draft.delete(id)
      return draft
    })
  }

  const toggleAll = (next: boolean): void => {
    setSelected(next ? new Set(selectable) : new Set())
  }

  const totalBytes = (rows ?? []).reduce((sum, row) => sum + row.totalBytes, 0)
  const pendingCount = (rows ?? []).filter(row => row.pending !== undefined).length

  const fail = (error: unknown): void => {
    if (!mounted.current)
      return
    setOutcome({ ok: false, text: `${t('failed')}: ${error instanceof Error ? error.message : String(error)}` })
  }

  const doUnarchive = async (): Promise<void> => {
    if (selectedIds.length === 0)
      return
    setBusy(true)
    setFailures([])
    try {
      const body = await postArchiveUnarchive({ ids: selectedIds })
      setSelected(new Set())
      setOutcome({ ok: true, text: `${t('archiveUnarchived')}: ${body.totals.unarchived}` })
    }
    catch (error) {
      fail(error)
    }
    finally {
      if (mounted.current) {
        setBusy(false)
        setReload(value => value + 1)
      }
    }
  }

  const doCancelPending = async (): Promise<void> => {
    if (pendingSelected.length === 0)
      return
    setBusy(true)
    try {
      const body = await postArchivePendingCancel({ ids: pendingSelected })
      setOutcome({ ok: true, text: `${t('archivePendingCancelled')}: ${body.totals.cancelled}` })
    }
    catch (error) {
      fail(error)
    }
    finally {
      if (mounted.current) {
        setBusy(false)
        setReload(value => value + 1)
      }
    }
  }

  const openPlan = async (): Promise<void> => {
    if (selectedIds.length === 0)
      return
    setBusy(true)
    setAcknowledged(false)
    try {
      const body = await postArchivePlan({ ids: selectedIds, cleanupAttachments })
      if (!mounted.current)
        return
      setPlan(body)
      setDialogOpen(true)
    }
    catch (error) {
      fail(error)
    }
    finally {
      if (mounted.current)
        setBusy(false)
    }
  }

  const doDelete = async (): Promise<void> => {
    if (selectedIds.length === 0)
      return
    setBusy(true)
    try {
      const body: ArchiveRemoveResponse = await deleteArchived({ ids: selectedIds, cleanupAttachments })
      if (!mounted.current)
        return
      setDialogOpen(false)
      setPlan(null)
      setSelected(new Set())
      setOutcome({
        ok: body.totals.failed === 0,
        text: `${t('archiveDeleted')}: ${body.totals.deleted} · ${t('archiveQueued')}: ${body.totals.queued} · ${t('archiveFreed')}: ${formatBytes(body.totals.freedBytes)}`,
      })
      const lines: ArchiveFailureLine[] = []
      for (const result of body.results) {
        if (result.code !== undefined)
          lines.push({ id: result.id, text: `${result.code}${result.message === undefined ? '' : ` — ${result.message}`}` })
        for (const warning of result.warnings)
          lines.push({ id: result.id, text: warning })
      }
      if (body.attachment.skipped !== undefined && body.attachment.skipped !== 'disabled')
        lines.push({ id: t('archiveAttachment'), text: body.attachment.skipped })
      setFailures(lines)
    }
    catch (error) {
      fail(error)
    }
    finally {
      if (mounted.current) {
        setBusy(false)
        setReload(value => value + 1)
      }
    }
  }

  const planItems = plan?.items ?? []
  const planRejected = planItems.filter(item => !item.ok)
  const planQueued = planItems.filter(item => item.ok && (item.pending !== undefined || item.willQueue === true))
  const planImmediate = planItems.filter(item => item.ok && item.pending === undefined && item.willQueue !== true)

  return (
    <div className="dshp-extension__section">
      <div className="dshp-extension__head">
        <span className="dshp-extension__head-icon"><Icon as={Tray} size={16} /></span>
        <h3>{t('archiveTitle')}</h3>
        <span className="dshp-extension__spacer" />
        <IconButton
          variant="toolbar"
          icon={<Icon as={ArrowRotateRight} />}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={busy}
          onClick={() => setReload(value => value + 1)}
        />
      </div>
      <p className="dshp-extension__intro">{t('archiveIntro')}</p>

      {outcome !== null && (
        <div className="dshp-extension__banner" data-kind={outcome.ok ? 'ok' : 'error'} role="status">
          <StateDot state={outcome.ok ? 'done' : 'error'} size={10} />
          <div className="dshp-extension__banner-body">{outcome.text}</div>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="dshp-extension__banner" data-kind="info" role="status">
          <StateDot state="ongoing" size={10} />
          <div className="dshp-extension__banner-body">
            <span>{t('archivePendingHint')}</span>
            <span className="dshp-extension__banner-hint">
              <Button variant="outline" size="sm" onClick={() => onNavigate('service')}>{t('goService')}</Button>
            </span>
          </div>
        </div>
      )}

      <div className="dshp-extension__list-head">
        <Checkbox checked={allSelected} disabled={busy || selectable.length === 0} onChange={next => toggleAll(next)}>
          {t('archiveSelectAll')}
        </Checkbox>
        <span className="dshp-extension__count">
          {selectedIds.length}
          /
          {selectable.length}
        </span>
        <span className="dshp-extension__count">{formatBytes(totalBytes)}</span>
        <span className="dshp-extension__spacer" />
        <Button variant="ghost" size="sm" disabled={busy || pendingSelected.length === 0} onClick={() => void doCancelPending()}>
          {t('archiveCancelPending')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || selectedIds.length === 0} onClick={() => void doUnarchive()}>
          {t('archiveUnarchive')}
        </Button>
        <Button variant="danger" size="sm" disabled={busy || selectedIds.length === 0} onClick={() => void openPlan()}>
          {t('delete')}
        </Button>
      </div>

      {rows === null && <p className="dshp-extension__empty">{t('loading')}</p>}
      {rows !== null && rows.length === 0 && <p className="dshp-extension__empty">{t('archiveEmpty')}</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="dshp-extension__sessions">
          {rows.map(row => (
            <li className="dshp-extension__session" key={row.id}>
              <Checkbox
                checked={selected.has(row.id)}
                disabled={busy}
                aria-label={shortId(row.id)}
                onChange={next => toggleOne(row.id, next)}
              />
              <div className="dshp-extension__session-body">
                <div className="dshp-extension__session-title-row">
                  <strong className="dshp-extension__session-title" title={row.id}>{shortId(row.id)}</strong>
                  {row.live && <Tag tone="warning">{t('archiveLive')}</Tag>}
                  {row.pending !== undefined && <Tag tone="info">{t('archivePending')}</Tag>}
                  {row.pending?.lastError != null && <Tag tone="danger">{t('archivePendingFailed')}</Tag>}
                  {row.duplicate && <Tag tone="danger">{t('archiveDuplicate')}</Tag>}
                  {!row.hasLog && <Tag tone="neutral">{t('archiveNoLog')}</Tag>}
                </div>
                <div className="dshp-extension__session-meta">
                  {row.workspaceTitle !== undefined && <span>{row.workspaceTitle}</span>}
                  <span>{formatBytes(row.totalBytes)}</span>
                  <span>
                    {row.logFiles}
                    {' '}
                    {t('archiveFiles')}
                  </span>
                  {row.descendants.length > 0 && (
                    <span>
                      {t('archiveDescendants')}
                      {' '}
                      {row.descendants.length}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleOne(row.id, !selected.has(row.id))}>
                {selected.has(row.id) ? t('archiveDeselect') : t('archiveSelect')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failures.length > 0 && (
        <div className="dshp-extension__banner" data-kind="error" role="status">
          <StateDot state="error" size={10} />
          <div className="dshp-extension__banner-body">
            <span>{t('archiveFailures')}</span>
            <ul className="dshp-extension__blockers">
              {failures.slice(0, 20).map((line, index) => <li key={`${line.id}:${index}`}>{shortId(line.id)} — {line.text}</li>)}
            </ul>
          </div>
        </div>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        closeLabel={t('close')}
        title={t('archiveDeleteTitle')}
        description={t('archiveDeleteWarn')}
        className="dshp-extension dshp-extension__modal-wide"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button variant="danger" disabled={busy || !acknowledged} onClick={() => void doDelete()}>{t('delete')}</Button>
          </>
        )}
      >
        <div className="dshp-extension__form">
          <ul className="dshp-extension__blockers">
            <li>{t('archiveImmediate')}: {planImmediate.length} · {formatBytes(plan?.totals.immediateBytes ?? 0)}</li>
            <li>{t('archiveQueued')}: {planQueued.length} · {formatBytes(plan?.totals.queuedBytes ?? 0)}</li>
            {planRejected.length > 0 && (
              <li>
                {t('archiveRejected')}
                :
                {' '}
                {planRejected.map(item => `${shortId(item.id)} (${item.code ?? 'unknown'})`).join(', ')}
              </li>
            )}
          </ul>
          <Checkbox checked={cleanupAttachments} disabled={busy} onChange={setCleanupAttachments}>
            {t('archiveCleanupAttachments')}
          </Checkbox>
          <p className="dshp-extension__intro">{t('archiveCleanupHint')}</p>
          <Checkbox checked={acknowledged} disabled={busy} onChange={setAcknowledged}>
            {t('archiveDeleteAck')}
          </Checkbox>
        </div>
      </Modal>
    </div>
  )
}
