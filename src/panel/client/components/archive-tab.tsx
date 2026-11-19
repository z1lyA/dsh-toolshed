import type { ReactElement, ReactNode } from 'react'
import type { ArchivePlanResponse, ArchiveRemoveResponse, ArchivedSessionView } from '../apis/index.type'
import type { ArchiveFailureLine, ArchiveTabProps } from './archive-tab.types'
import { Button, Checkbox, ChevronDown, Icon, Modal, StateDot, Tag, Tray } from 'dsh-tauri-ui/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteArchived, getArchived, postArchivePendingCancel, postArchivePlan, postArchiveUnarchive } from '../apis'
import { useTimers } from '../hooks/use-timers'
import { groupSessionsByWorkspace, selectionState } from './archive-tab.utils'

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
 * 三态勾选框。
 *
 * `Checkbox` 是官方原语，只有 `checked`，没有 `indeterminate`；而「半选」是这一页的硬需求
 * （全局全选跨折叠组，组内全选要如实反映组的状态）。这里不重画勾选框——样式、焦点环、禁用态
 * 都得跟原语一致——只在挂载/更新后把原生 input 的 `indeterminate` 打上去。
 * SSR 下 effect 不跑：静态标记与普通 Checkbox 完全一样，不会多出任何 DOM。
 */
function TriStateCheckbox({ checked, indeterminate, disabled, title, ariaLabel, label, onChange }: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  title: string
  ariaLabel?: string
  label?: ReactNode
  onChange: (next: boolean) => void
}): ReactElement {
  const holder = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const input = holder.current?.querySelector('input')
    if (input !== null && input !== undefined)
      input.indeterminate = indeterminate
  }, [indeterminate, checked])
  return (
    <span className="dshp-extension__archive-tristate" ref={holder}>
      <Checkbox checked={checked} disabled={disabled} title={title} aria-label={ariaLabel} onChange={onChange}>{label}</Checkbox>
    </span>
  )
}

/**
 * 「已归档」tab：DSH 没有删除会话的接口，这里补上，并把边界条件显式化。
 *
 * 关键交互规则（与宿主服务一一对应）：
 *  - 列表主层级是**工作区**：一行一个工作区、默认折叠，点开才看到该工作区的会话再逐条勾选；
 *  - 只有归档会话能被选中；取消归档会同时撤掉它的「待删除」意图；
 *  - 删除先走 dry-run 计划（`/archive/plan`），弹窗里分「立即删 / 排队 / 拒绝」三类；
 *  - **2.7.1 起删除一律排队**（`/archive/remove` 不再当场删）：排队项从列表里消失，只留一个计数与
 *    「取消待删除」；下次启动 DSH 时执行，想立刻执行就点右上角「重启服务」。
 *    这么做的原因：当场删要顺手清归档墓碑，而宿主内存里还记着这些会话，清掉墓碑后原生侧栏会把它们
 *    渲染成「未分类」空壳；把删除与墓碑清理都推到启动时，两个页面都不会出现中间态。
 */
export function ArchiveTab({ t }: ArchiveTabProps): ReactElement {
  const [rows, setRows] = useState<ArchivedSessionView[] | null>(null)
  /**
   * 已排队删除的会话 id（2.7.1 起删除一律排队）。
   *
   * 它们**不在** `rows` 里：宿主为了「删了就别再显示」把排队项从列表里去掉了，
   * 这里只留计数与一个「取消待删除」入口。
   */
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [outcome, setOutcome] = useState<{ ok: boolean, text: string } | null>(null)
  const [failures, setFailures] = useState<ArchiveFailureLine[]>([])
  const [plan, setPlan] = useState<ArchivePlanResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [cleanupAttachments, setCleanupAttachments] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  /**
   * 展开的工作区分组。默认空集合 = 全部折叠（用户要的是「先看工作区，点开才看会话」），
   * 且只作页面本地状态：键是工作区 id，所以刷新、删除后同一工作区仍然保持展开；
   * 不持久化——折叠与否是「这一眼想看什么」，不是需要记住的偏好。
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set())
  const { mounted } = useTimers()

  useEffect(() => {
    let current = true
    setBusy(true)
    void getArchived().then(
      (body) => {
        if (!current)
          return
        setRows(body.items)
        setPendingIds(Array.isArray(body.pendingIds) ? body.pendingIds : [])
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
  // 全局全选跨全部工作区（含折叠组里的会话）：数据源是整张 list，与展开状态无关。
  const allSelection = useMemo(() => selectionState(selectable, selected), [selectable, selected])
  const groups = useMemo(() => groupSessionsByWorkspace(rows ?? []), [rows])

  const toggleIds = (ids: readonly string[], next: boolean): void => {
    setSelected((previous) => {
      const draft = new Set(previous)
      for (const id of ids) {
        if (next)
          draft.add(id)
        else
          draft.delete(id)
      }
      return draft
    })
  }

  const toggleAll = (next: boolean): void => {
    toggleIds(selectable, next)
  }

  const toggleOpen = (key: string): void => {
    setOpenGroups((previous) => {
      const draft = new Set(previous)
      if (draft.has(key))
        draft.delete(key)
      else
        draft.add(key)
      return draft
    })
  }

  const totalBytes = (rows ?? []).reduce((sum, row) => sum + row.totalBytes, 0)
  const pendingCount = pendingIds.length

  /** 会话行。分组只改层级，行内信息（占用/文件数/子代理数/待删除与失败标记）逐条照旧。 */
  const renderRow = (row: ArchivedSessionView): ReactElement => (
    <li className="dshp-extension__session" key={row.id}>
      <Checkbox
        checked={selected.has(row.id)}
        disabled={busy}
        aria-label={row.title ?? shortId(row.id)}
        onChange={next => toggleIds([row.id], next)}
      />
      <div className="dshp-extension__session-body">
        <div className="dshp-extension__session-title-row">
          <strong className="dshp-extension__session-name" title={row.title ?? row.id}>
            {row.title ?? shortId(row.id)}
          </strong>
          {row.live && <Tag tone="warning">{t('archiveLive')}</Tag>}
          {row.pending !== undefined && <Tag tone="info">{t('archivePending')}</Tag>}
          {row.pending?.lastError != null && <Tag tone="danger">{t('archivePendingFailed')}</Tag>}
          {row.duplicate && <Tag tone="danger">{t('archiveDuplicate')}</Tag>}
          {!row.hasLog && <Tag tone="neutral">{t('archiveNoLog')}</Tag>}
        </div>
        <div className="dshp-extension__session-meta">
          {/* 有名字时 id 退到第二行做区分（同名会话不少见），没有名字时它就是标题 */}
          {row.title !== undefined && <span className="dshp-extension__session-id" title={row.id}>{shortId(row.id)}</span>}
          {/* 工作区名只在组头上出现一次：组内每行再写一遍是纯噪声 */}
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
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleIds([row.id], !selected.has(row.id))}>
        {selected.has(row.id) ? t('archiveDeselect') : t('archiveSelect')}
      </Button>
    </li>
  )

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
    if (pendingIds.length === 0)
      return
    setBusy(true)
    try {
      const body = await postArchivePendingCancel({ ids: pendingIds })
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
        // 2.7.1 起删除一律排队：主句必须说「已排队」，否则用户会以为磁盘已经释放了。
        text: `${t('archiveQueued')}: ${body.totals.queued} · ${t('archiveDeferred')}${body.totals.failed === 0 ? '' : ` · ${t('archiveFailures')}: ${body.totals.failed}`}`,
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
        {/* 用文字按钮而不是图标：面板右上角的重启控件已经有一个刷新图标，两个旋转图标并排会认错。 */}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{t('refresh')}</Button>
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
          </div>
        </div>
      )}

      <div className="dshp-extension__list-head">
        <TriStateCheckbox
          checked={allSelection.checked}
          indeterminate={allSelection.indeterminate}
          disabled={busy || selectable.length === 0}
          title={t('archiveSelectAll')}
          label={t('archiveSelectAll')}
          onChange={next => toggleAll(next)}
        />
        <span className="dshp-extension__count">
          {allSelection.count}
          /
          {selectable.length}
        </span>
        <span className="dshp-extension__count">{formatBytes(totalBytes)}</span>
        <span className="dshp-extension__spacer" />
        <Button variant="ghost" size="sm" disabled={busy || pendingIds.length === 0} onClick={() => void doCancelPending()}>
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
        <ul className="dshp-extension__archive-groups">
          {groups.map((group) => {
            const state = selectionState(group.rows.map(row => row.id), selected)
            const open = openGroups.has(group.key)
            const name = group.title ?? t('archiveGroupUnassigned')
            return (
              <li className="dshp-extension__archive-group" key={group.key}>
                <div className="dshp-extension__list-head">
                  {/* 折叠态挂在自家 span 上（data-open），不赌原语是否把 data-* 透传到 DOM */}
                  <span className="dshp-extension__archive-group-toggle" data-open={open ? 'true' : 'false'}>
                    <Button variant="ghost" size="sm" aria-expanded={open} title={name} onClick={() => toggleOpen(group.key)}>
                      <Icon as={ChevronDown} size={14} className="dshp-extension__archive-chevron" />
                      <span className="dshp-extension__archive-group-title">{name}</span>
                    </Button>
                  </span>
                  <span className="dshp-extension__count">
                    {/* 有勾选时给出「已选/总数」，否则只报组内会话数：折叠状态下也能看出这组选中了什么 */}
                    {state.count > 0 ? `${state.count}/${group.rows.length}` : group.rows.length}
                    {' '}
                    {t('archiveGroupSessions')}
                  </span>
                  <span className="dshp-extension__count">{formatBytes(group.totalBytes)}</span>
                  {group.pendingCount > 0 && <Tag tone="info">{`${t('archivePending')} ${group.pendingCount}`}</Tag>}
                  <span className="dshp-extension__spacer" />
                  {/* 组内全选：只动这一组的 id，不再碰别的组；半选口径与全局全选共用 selectionState */}
                  <TriStateCheckbox
                    checked={state.checked}
                    indeterminate={state.indeterminate}
                    disabled={busy}
                    title={t('archiveGroupSelectAll')}
                    ariaLabel={t('archiveGroupSelectAll')}
                    onChange={next => toggleIds(group.rows.map(row => row.id), next)}
                  />
                </div>
                {open && (
                  <ul className="dshp-extension__sessions dshp-extension__archive-group-rows">
                    {group.rows.map(row => renderRow(row))}
                  </ul>
                )}
              </li>
            )
          })}
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
            {/* 2.7.1 起全部排队，所以「立即」那行只在真有立即项时才出现（版面不浪费在一行 0 上）。 */}
            {planImmediate.length > 0 && (
              <li>{t('archiveImmediate')}: {planImmediate.length} · {formatBytes(plan?.totals.immediateBytes ?? 0)}</li>
            )}
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
