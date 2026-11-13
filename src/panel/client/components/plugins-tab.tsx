import type { ReactElement } from 'react'
import type { PluginRowView, PluginToggleResponse } from '../apis/index.type'
import type { PluginRowItemProps, PluginsTabProps, PluginUndoRecord } from './plugins-tab.types'
import { Button, Icon, Input, Puzzle, StateDot, Switch, Tag } from 'dsh-tauri-ui/client'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, getPlugins, postPluginToggle } from '../apis'
import { useTimers } from '../hooks/use-timers'

/** 官方模块名有统一前缀，列表里一律省略（227 行全长名字会把 entryId 那列挤没），全名留在 title。 */
const MODULE_PREFIX = '@deepseek-ai/'

function shortModuleName(moduleName: string): string {
  return moduleName.startsWith(MODULE_PREFIX) ? moduleName.slice(MODULE_PREFIX.length) : moduleName
}

/**
 * 不可启停原因码 → 一句话。
 *
 * 文案照官方中文词典（spike-host §5）：这是用户唯一能看到「为什么开关点不动」的地方。
 * 官方新增原因码时原样透出，不猜文案——猜错的解释比机器码更糟。
 */
function readOnlyReasonText(t: PluginRowItemProps['t'], reason: string): string {
  if (reason === 'management-required')
    return t('pluginReasonManagement')
  if (reason === 'unaddressable')
    return t('pluginReasonUnaddressable')
  return reason
}

/**
 * 启停结果 → banner 文案。
 *
 * `application` 原样透出四个真实结局：压成「成功/失败」会让「被更高优先级覆盖」伪装成生效，
 * 而「激活失败」时配置文件其实已经写了（`changed: true`），页面必须如实说明并允许撤销。
 */
function toggleOutcomeOf(t: PluginRowItemProps['t'], body: PluginToggleResponse): { ok: boolean, text: string } {
  if (body.application === 'applied')
    return { ok: true, text: t('pluginApplied') }
  if (body.application === 'restart-required')
    return { ok: true, text: t('pluginRestartRequired') }
  if (body.application === 'overridden')
    return { ok: true, text: t('pluginOverridden') }
  // `failed` / `cancelled`：机器码与诊断都带上，否则用户只知道「没生效」却没法贴 issue。
  const detail = [body.errorCode ?? body.application, body.diagnostic].filter(part => part !== undefined && part !== '').join(' — ')
  return { ok: false, text: `${t('pluginToggleFailed')}${detail === '' ? '' : ` (${detail})`}` }
}

/** 异常路径的原因：409 / 503 这两个 code 是我们自己拦下的，直接给可执行的说明。 */
function failureTextOf(t: PluginRowItemProps['t'], cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'self-management')
      return t('pluginSelfManagement')
    if (cause.code === 'plugin-manager-unavailable')
      return t('pluginUnavailable')
    return `${t('pluginToggleFailed')}: ${cause.message} (${cause.code ?? `HTTP ${cause.status}`})`
  }
  return `${t('pluginToggleFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`
}

/**
 * 单行渲染。
 *
 * 为什么导出：`renderToStaticMarkup` 不跑 `useEffect`，拿不到拉取结果，于是「不可启停的行是什么样」
 * 只能靠直接喂一行数据来覆盖（见 `plugins-tab.render.test.tsx`）。
 */
export function PluginRowItem({ t, row, busy, onToggle }: PluginRowItemProps): ReactElement {
  const reason = row.readOnlyReason === undefined ? undefined : readOnlyReasonText(t, row.readOnlyReason)
  const readOnly = reason !== undefined
  return (
    <li className="dshp-extension__plugin-row">
      <div className="dshp-extension__plugin-row-main">
        <strong className="dshp-extension__plugin-row-name" title={row.moduleName}>{shortModuleName(row.moduleName)}</strong>
        <span className="dshp-extension__plugin-row-id" title={row.entryId}>{row.entryId}</span>
      </div>
      <div className="dshp-extension__plugin-row-tags">
        <Tag tone={row.enabled ? 'neutral' : 'warning'}>{row.enabled ? t('pluginEnabled') : t('pluginDisabled')}</Tag>
        {row.fiberPhase === 'active' && <Tag tone="info">{t('pluginPhaseActive')}</Tag>}
        {row.fiberPhase === 'failed' && <Tag tone="danger">{t('pluginPhaseFailed')}</Tag>}
        {row.fiberPhase !== null && row.fiberPhase !== 'active' && row.fiberPhase !== 'failed' && <Tag tone="neutral">{row.fiberPhase}</Tag>}
      </div>
      {/*
        禁用态的 `<button>` 在 Chromium 里收不到鼠标事件、title 常不弹，所以原因同时挂在外层
        那个不会禁用的 span 上（与 restart-control.tsx 同一个坑）。
      */}
      <span className="dshp-extension__tip" title={reason}>
        <Switch
          checked={row.enabled}
          disabled={busy || readOnly}
          label={t('toggle')}
          title={reason}
          onChange={() => onToggle(row)}
        />
      </span>
    </li>
  )
}

/**
 * 「插件」tab：当前 profile 加载的插件清单 + 行级启停。
 *
 * 为什么自己写 UI 而不是嵌官方页：官方插件页只导出 `NS/PANEL_ID/apply/inject`，没有组件也没有
 * `render()`，嵌不进来（spike-client §1.2）。数据与启停都走宿主转发（`/api/plugins*`），
 * 市场只给一个「打开官方页」的按钮——市场 UI 不可复用，复刻必然跟着索引格式漂移（§2.5）。
 */
export function PluginsTab({ t, openMarket }: PluginsTabProps): ReactElement {
  const [rows, setRows] = useState<PluginRowView[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'info' | 'error', text: string } | null>(null)
  const [undo, setUndo] = useState<PluginUndoRecord | null>(null)
  const { mounted } = useTimers()

  useEffect(() => {
    let current = true
    void getPlugins().then(
      (body) => {
        if (current)
          setRows(body.plugins)
      },
      (error: unknown) => {
        if (!current)
          return
        setRows([])
        // 503 是「这个部署没有插件管理服务」，不是网络故障：文案要能直接回答「为什么是空的」。
        const unavailable = error instanceof ApiError && error.code === 'plugin-manager-unavailable'
        setBanner({
          kind: 'error',
          text: unavailable ? t('pluginUnavailable') : `${t('failed')}: ${error instanceof Error ? error.message : String(error)}`,
        })
      },
    )
    return () => {
      current = false
    }
  }, [reload, t])

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (rows ?? []).filter(row => needle === ''
      || row.moduleName.toLowerCase().includes(needle)
      || row.entryId.toLowerCase().includes(needle)),
    [needle, rows],
  )

  const doToggle = async (row: PluginRowView): Promise<void> => {
    const previousEnabled = row.enabled
    setBusy(true)
    try {
      const body = await postPluginToggle({ entryId: row.entryId, enabled: !previousEnabled })
      if (!mounted.current)
        return
      const outcome = toggleOutcomeOf(t, body)
      setBanner({ kind: outcome.ok ? 'ok' : 'error', text: outcome.text })
      // `failed` 时配置文件已经写了（changed: true）：必须留撤销，否则「启用一个会崩的插件」之后
      // 条目从列表里消失，反向调用只能拿 `unknown-plugin`（spike-host §9 风险②），用户没有退路。
      if (body.changed)
        setUndo({ entryId: row.entryId, moduleName: row.moduleName, previousEnabled })
      setReload(value => value + 1)
    }
    catch (error) {
      if (!mounted.current)
        return
      const blocked = error instanceof ApiError && error.code === 'self-management'
      setBanner({ kind: 'error', text: failureTextOf(t, error) })
      // 被宿主挡下的请求（409 停用自己 / 503 服务缺失）什么都没写，不留撤销记录；
      // 其余异常无法确认「写没写」，反向调用是幂等的安全退路，留一条。
      if (!blocked)
        setUndo({ entryId: row.entryId, moduleName: row.moduleName, previousEnabled })
      setReload(value => value + 1)
    }
    finally {
      if (mounted.current)
        setBusy(false)
    }
  }

  /** 撤销 = 用同一个 entryId 反向调一次；失败时保留记录，用户还能重试。 */
  const doUndo = async (): Promise<void> => {
    const record = undo
    if (record === null)
      return
    setBusy(true)
    try {
      const body = await postPluginToggle({ entryId: record.entryId, enabled: record.previousEnabled })
      if (!mounted.current)
        return
      if (body.ok) {
        setUndo(null)
        setBanner({ kind: 'info', text: `${t('pluginUndone')}: ${shortModuleName(record.moduleName)}` })
      }
      else {
        setBanner({ kind: 'error', text: toggleOutcomeOf(t, body).text })
      }
    }
    catch (error) {
      if (mounted.current)
        setBanner({ kind: 'error', text: failureTextOf(t, error) })
    }
    finally {
      if (mounted.current) {
        setBusy(false)
        setReload(value => value + 1)
      }
    }
  }

  return (
    <div className="dshp-extension__section">
      <div className="dshp-extension__head">
        <span className="dshp-extension__head-icon"><Icon as={Puzzle} size={16} /></span>
        <h3>{t('pluginsTitle')}</h3>
        <span className="dshp-extension__spacer" />
        {/* 文字按钮而不是图标：右上角重启控件已经占了一个旋转图标，两个图标并排会认错。 */}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{t('refresh')}</Button>
        {openMarket !== undefined && <Button variant="primary" size="sm" title={t('pluginMarketHint')} onClick={openMarket}>{t('pluginMarket')}</Button>}
      </div>
      <p className="dshp-extension__intro">{t('pluginsIntro')}</p>

      {banner !== null && (
        <div className="dshp-extension__banner" data-kind={banner.kind} role="status">
          <StateDot state={banner.kind === 'error' ? 'error' : banner.kind === 'ok' ? 'done' : 'ongoing'} size={10} />
          <div className="dshp-extension__banner-body"><span>{banner.text}</span></div>
          {undo !== null && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={`${t('pluginUndo')}: ${shortModuleName(undo.moduleName)}`}
              onClick={() => void doUndo()}
            >
              {t('pluginUndo')}
            </Button>
          )}
        </div>
      )}

      <div className="dshp-extension__list-head">
        <h3>{t('pluginsTab')}</h3>
        {rows !== null && (
          <span className="dshp-extension__count">
            {filtered.length}
            /
            {rows.length}
          </span>
        )}
        <span className="dshp-extension__spacer" />
        {/* 227 条是常态（本机 profile 实测），没有搜索这个页面不可用。 */}
        <Input
          className="dshp-extension__search"
          type="search"
          placeholder={t('pluginSearch')}
          aria-label={t('pluginSearch')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>

      {rows === null && <p className="dshp-extension__empty">{t('loading')}</p>}
      {rows !== null && rows.length === 0 && <p className="dshp-extension__empty">{t('pluginEmpty')}</p>}
      {rows !== null && rows.length > 0 && filtered.length === 0 && <p className="dshp-extension__empty">{t('pluginNoMatch')}</p>}
      {filtered.length > 0 && (
        <ul className="dshp-extension__plugin-list">
          {filtered.map(row => <PluginRowItem key={row.entryId} t={t} row={row} busy={busy} onToggle={target => void doToggle(target)} />)}
        </ul>
      )}
    </div>
  )
}
