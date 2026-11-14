import type { ReactElement } from 'react'
import type { LocalizedTextView, PluginBundleRowView, PluginBundleView, PluginsListResponse, PluginToggleResponse } from '../apis/index.type'
import type { Translate } from '../locales/index.types'
import type {
  PluginBundleCardProps,
  PluginFilter,
  PluginRowItemProps,
  PluginsTabProps,
  PluginUndoRecord,
  ResolveLocalizedText,
} from './plugins-tab.types'
import { Button, ChevronDown, Icon, Input, Puzzle, SegmentedControl, StateDot, Switch, Tag } from 'dsh-tauri-ui/client'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, getPlugins, postPluginBundleToggle, postPluginToggle } from '../apis'
import { useTimers } from '../hooks/use-timers'

/** 官方模块名有统一前缀，行内一律省略（全名留在 title）。 */
const MODULE_PREFIX = '@deepseek-ai/'

function shortModuleName(moduleName: string): string {
  return moduleName.startsWith(MODULE_PREFIX) ? moduleName.slice(MODULE_PREFIX.length) : moduleName
}

/**
 * 本地化文案的兜底解析。
 *
 * 正常路径是 register 层注入的 `ctx.locale.resolveText`（谁的语言由运行时决定，组件不选）。
 * 拿不到解析器时退回 `en`：宁可显示英文，也不要让卡片标题变成空串或 `undefined`。
 */
export function localizedTextOf(text: LocalizedTextView | undefined, resolveText?: ResolveLocalizedText): string {
  if (text === undefined)
    return ''
  let resolved: string | undefined
  if (resolveText !== undefined) {
    try {
      resolved = resolveText(text)
    }
    catch {
      resolved = undefined
    }
  }
  if (typeof resolved === 'string' && resolved.trim() !== '')
    return resolved
  return typeof text === 'string' ? text : (text && text.en) || ''
}

/** 卡片标题：本地化标题 → 包名（包名从不缺席，所以标题永远有内容）。 */
export function bundleTitleOf(bundle: PluginBundleView, resolveText?: ResolveLocalizedText): string {
  const title = localizedTextOf(bundle.title, resolveText).trim()
  return title === '' ? bundle.name : title
}

/** 一句话简介：本地化简介 → manifest 里的原始 description（未本地化，但比空着有用）。 */
export function bundleDescriptionOf(bundle: PluginBundleView, resolveText?: ResolveLocalizedText): string {
  const description = localizedTextOf(bundle.description, resolveText).trim()
  if (description !== '')
    return description
  return (bundle.manifestDescription ?? '').trim()
}

function bundleMatchesFilter(bundle: PluginBundleView, filter: PluginFilter): boolean {
  if (filter === 'official')
    return bundle.official
  if (filter === 'third-party')
    return !bundle.official
  return true
}

/**
 * 搜索面：包名、包标题、包简介、以及包内每一条 Loader 条目的 moduleName / entryId。
 *
 * 为什么带包内条目：用户常记得的是条目名（「有个 pwsh sandbox」），而那是包里的行、不是包名。
 */
function bundleMatchesQuery(bundle: PluginBundleView, needle: string, resolveText?: ResolveLocalizedText): boolean {
  if (needle === '')
    return true
  const haystack = [bundle.name, bundleTitleOf(bundle, resolveText), bundleDescriptionOf(bundle, resolveText)]
  if (haystack.some(value => value.toLowerCase().includes(needle)))
    return true
  return bundle.rows.some(row => row.moduleName.toLowerCase().includes(needle)
    || (row.entryId ?? '').toLowerCase().includes(needle))
}

/**
 * 不可启停原因码 → 一句话。
 *
 * 文案照官方中文词典（spike-host §5）：这是用户唯一能看到「为什么开关点不动」的地方。
 * 官方新增原因码时原样透出，不猜文案——猜错的解释比机器码更糟。
 */
function readOnlyReasonText(t: Translate, reason: string): string {
  if (reason === 'management-required')
    return t('pluginReasonManagement')
  if (reason === 'unaddressable')
    return t('pluginReasonUnaddressable')
  return reason
}

/**
 * 包级开关的禁用原因（`undefined` = 可点）。
 *
 * 官方包一律禁用：官方页才负责保护集、目录与卸载，这里只做第三方包的一键启停；
 * 官方自己给了 `readOnlyReason` 的包优先显示官方原因。
 */
export function bundleToggleReasonOf(t: Translate, bundle: PluginBundleView): string | undefined {
  if (bundle.readOnlyReason !== undefined)
    return readOnlyReasonText(t, bundle.readOnlyReason)
  if (bundle.official)
    return t('pluginOfficialManage')
  return undefined
}

/**
 * 行级开关的禁用原因，保持 v1 行为：有 `patchId` 且非本插件即可点（官方包的行也给——粒度细、可逆）。
 *
 * 包被停用时它的行没有存活的 Loader 条目（没有 `entryId`），启停请求无从下手，只能先启用包。
 */
function rowToggleReasonOf(t: Translate, row: PluginBundleRowView): string | undefined {
  if (row.readOnlyReason !== undefined)
    return readOnlyReasonText(t, row.readOnlyReason)
  if (row.entryId === undefined)
    return t('pluginRowNoEntry')
  if (row.patchId === undefined)
    return t('pluginReasonUnaddressable')
  return undefined
}

/**
 * 启停结果 → banner 文案。
 *
 * `application` 原样透出四个真实结局：压成「成功/失败」会让「被更高优先级覆盖」伪装成生效，
 * 而「激活失败」时配置文件其实已经写了（`changed: true`），页面必须如实说明并允许撤销。
 */
function toggleOutcomeOf(t: Translate, body: PluginToggleResponse): { ok: boolean, text: string } {
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
function failureTextOf(t: Translate, cause: unknown): string {
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
 * 单行渲染（展开后的 Loader 条目）。
 *
 * 为什么导出：`renderToStaticMarkup` 不跑 `useEffect`，拿不到拉取结果，于是「不可启停的行是什么样」
 * 只能靠直接喂一行数据来覆盖（见 `plugins-tab.render.test.tsx`）。
 */
export function PluginRowItem({ t, row, busy, onToggle }: PluginRowItemProps): ReactElement {
  const reason = rowToggleReasonOf(t, row)
  const readOnly = reason !== undefined
  return (
    <li className="dshp-extension__plugin-row">
      <div className="dshp-extension__plugin-row-main">
        <strong className="dshp-extension__plugin-row-name" title={row.moduleName}>{shortModuleName(row.moduleName)}</strong>
        <span className="dshp-extension__plugin-row-id" title={row.entryId ?? row.rowId}>{row.entryId ?? row.rowId}</span>
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
 * 一个 npm 包（bundle）的卡片：图标 + 名称 + 一句话简介 + 状态 + 开关，可展开看它的 Loader 条目。
 *
 * 为什么以包为单位（v1 的教训）：v1 铺的是 Loader 条目，本机 227 条、绝大多数是 DSH 自己的内部模块，
 * 既看不出「装了什么」，也没法批量管理；官方页的卡片同样是包级的，而包级数据里本来就带
 * `meta.title/description/icon`（图标是 base64 data URL）。
 */
export function PluginBundleCard({
  t,
  bundle,
  resolveText,
  busy,
  expanded,
  onToggleExpanded,
  onToggleBundle,
  onToggleRow,
}: PluginBundleCardProps): ReactElement {
  const title = bundleTitleOf(bundle, resolveText)
  const description = bundleDescriptionOf(bundle, resolveText)
  const switchReason = bundleToggleReasonOf(t, bundle)
  return (
    <li
      className="dshp-extension__plugin-card"
      data-official={bundle.official ? 'true' : 'false'}
      data-enabled={bundle.enabled ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <span className="dshp-extension__plugin-card-icon" aria-hidden="true">
        {bundle.icon !== undefined && bundle.icon !== ''
          ? <img className="dshp-extension__plugin-card-img" src={bundle.icon} alt="" width={28} height={28} />
          : <Icon as={Puzzle} size={18} />}
      </span>
      <div className="dshp-extension__plugin-card-main">
        <div className="dshp-extension__plugin-card-title-row">
          {/* 展开入口放在标题上：整块标题可点，箭头只是视觉提示；全名（npm 包名）始终留在 title。 */}
          <button
            type="button"
            className="dshp-extension__plugin-card-title"
            title={bundle.name}
            aria-expanded={expanded}
            aria-label={`${t('pluginExpand')}: ${title}`}
            onClick={onToggleExpanded}
          >
            <span className="dshp-extension__plugin-card-name">{title}</span>
            <Icon
              className="dshp-extension__plugin-card-chevron"
              data-expanded={expanded ? 'true' : 'false'}
              as={ChevronDown}
              size={12}
            />
          </button>
          {bundle.version !== undefined && bundle.version !== '' && (
            <span className="dshp-extension__plugin-card-version">{bundle.version}</span>
          )}
          <Tag tone={bundle.enabled ? 'neutral' : 'warning'}>{bundle.enabled ? t('pluginEnabled') : t('pluginDisabled')}</Tag>
          {switchReason !== undefined && <Tag tone="info">{switchReason}</Tag>}
          {bundle.errorCode !== undefined && bundle.errorCode !== '' && <Tag tone="danger">{bundle.errorCode}</Tag>}
        </div>
        {description !== '' && <p className="dshp-extension__plugin-card-desc">{description}</p>}
        <div className="dshp-extension__plugin-card-meta">
          <Tag tone="outline">{bundle.official ? t('pluginsFilterOfficial') : t('pluginsFilterThirdParty')}</Tag>
          <span className="dshp-extension__plugin-card-pkg" title={bundle.name}>{bundle.name}</span>
        </div>
        {expanded && (bundle.rows.length === 0
          ? <p className="dshp-extension__empty">{t('pluginRowsEmpty')}</p>
          : (
              <ul className="dshp-extension__plugin-card-rows">
                {bundle.rows.map(row => (
                  <PluginRowItem key={row.rowId} t={t} row={row} busy={busy} onToggle={onToggleRow} />
                ))}
              </ul>
            ))}
      </div>
      <span className="dshp-extension__tip" title={switchReason}>
        <Switch
          checked={bundle.enabled}
          disabled={busy || switchReason !== undefined}
          label={t('toggle')}
          title={switchReason}
          onChange={() => onToggleBundle(bundle)}
        />
      </span>
    </li>
  )
}

/**
 * 「插件」tab：以 **npm 包**为单位展示 + 包级/行级启停 + 市场入口。
 *
 * 为什么自己不嵌官方页：官方插件页只导出 `NS/PANEL_ID/apply/inject`，没有组件也没有 `render()`，
 * 嵌不进来（spike-client §1.2）。数据与启停都走宿主转发（`/api/plugins*`），市场只给一个
 * 「打开官方页并落到发现 tab」的按钮——市场 UI 不可复用，复刻必然跟着索引格式漂移（§2.5）。
 */
export function PluginsTab({ t, openMarket, resolveText }: PluginsTabProps): ReactElement {
  const [data, setData] = useState<PluginsListResponse | null>(null)
  // 默认「第三方」：官方包会把这几个包淹掉，而用户要管的正是第三方那几个。
  const [filter, setFilter] = useState<PluginFilter>('third-party')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'info' | 'error', text: string } | null>(null)
  const [undo, setUndo] = useState<PluginUndoRecord | null>(null)
  const { mounted } = useTimers()

  useEffect(() => {
    let current = true
    void getPlugins().then(
      (body) => {
        if (!current)
          return
        // 宿主半与客户端半可以各自升级：老宿主只回 `{ plugins }`，缺字段时按空清单处理，
        // 而不是让整页在 `.filter` 上抛错。
        setData({
          bundles: Array.isArray(body.bundles) ? body.bundles : [],
          plugins: Array.isArray(body.plugins) ? body.plugins : [],
        })
      },
      (error: unknown) => {
        if (!current)
          return
        setData({ bundles: [], plugins: [] })
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

  const bundles = data?.bundles ?? []
  const plugins = data?.plugins ?? []
  const needle = query.trim().toLowerCase()
  const visible = bundles.filter(bundle => bundleMatchesFilter(bundle, filter) && bundleMatchesQuery(bundle, needle, resolveText))

  const toggleExpanded = (name: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(name))
        next.delete(name)
      else
        next.add(name)
      return next
    })
  }

  /**
   * 一次变更之后共用的收尾：写 banner、必要时留撤销记录、重拉清单。
   *
   * `body.changed` 才是「配置文件真的被改了」，`ok` 只是「官方没报失败」——
   * `failed` 也可能 `changed: true`，那种情况必须留撤销（否则用户没有退路）。
   */
  const settle = (body: PluginToggleResponse, record: PluginUndoRecord): void => {
    const outcome = toggleOutcomeOf(t, body)
    setBanner({ kind: outcome.ok ? 'ok' : 'error', text: outcome.text })
    if (body.changed)
      setUndo(record)
  }

  const doToggleBundle = async (bundle: PluginBundleView): Promise<void> => {
    const record: PluginUndoRecord = { kind: 'bundle', id: bundle.name, label: bundle.name, previousEnabled: bundle.enabled }
    setBusy(true)
    try {
      const body = await postPluginBundleToggle({ name: bundle.name, enabled: !bundle.enabled })
      if (!mounted.current)
        return
      settle(body, record)
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
        setUndo(record)
      setReload(value => value + 1)
    }
    finally {
      if (mounted.current)
        setBusy(false)
    }
  }

  const doToggleRow = async (row: PluginBundleRowView): Promise<void> => {
    if (row.entryId === undefined)
      return
    const entryId = row.entryId
    const record: PluginUndoRecord = {
      kind: 'row',
      id: entryId,
      label: shortModuleName(row.moduleName),
      previousEnabled: row.enabled,
    }
    setBusy(true)
    try {
      const body = await postPluginToggle({ entryId, enabled: !row.enabled })
      if (!mounted.current)
        return
      settle(body, record)
      setReload(value => value + 1)
    }
    catch (error) {
      if (!mounted.current)
        return
      const blocked = error instanceof ApiError && error.code === 'self-management'
      setBanner({ kind: 'error', text: failureTextOf(t, error) })
      if (!blocked)
        setUndo(record)
      setReload(value => value + 1)
    }
    finally {
      if (mounted.current)
        setBusy(false)
    }
  }

  /** 撤销 = 用同一条记录反向调一次；失败时保留记录，用户还能重试。 */
  const doUndo = async (): Promise<void> => {
    const record = undo
    if (record === null)
      return
    setBusy(true)
    try {
      const body = record.kind === 'bundle'
        ? await postPluginBundleToggle({ name: record.id, enabled: record.previousEnabled })
        : await postPluginToggle({ entryId: record.id, enabled: record.previousEnabled })
      if (!mounted.current)
        return
      if (body.ok) {
        setUndo(null)
        setBanner({ kind: 'info', text: `${t('pluginUndone')}: ${record.label}` })
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

  const filterOptions = useMemo(() => ([
    { value: 'all', label: t('pluginsFilterAll') },
    { value: 'third-party', label: t('pluginsFilterThirdParty') },
    { value: 'official', label: t('pluginsFilterOfficial') },
  ]), [t])

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
      {/* 这段说明是用户问题「为什么有两百多个插件」的答案：铺开的是包，不是 227 条 Loader 条目。 */}
      <p className="dshp-extension__intro">{t('pluginsIntroV2')}</p>

      {banner !== null && (
        <div className="dshp-extension__banner" data-kind={banner.kind} role="status">
          <StateDot state={banner.kind === 'error' ? 'error' : banner.kind === 'ok' ? 'done' : 'ongoing'} size={10} />
          <div className="dshp-extension__banner-body"><span>{banner.text}</span></div>
          {undo !== null && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={`${t('pluginUndo')}: ${undo.label}`}
              onClick={() => void doUndo()}
            >
              {t('pluginUndo')}
            </Button>
          )}
        </div>
      )}

      <div className="dshp-extension__plugin-toolbar">
        <SegmentedControl
          label={t('pluginsTab')}
          value={filter}
          options={filterOptions}
          onChange={(next) => setFilter(next as PluginFilter)}
        />
        {data !== null && (
          <span className="dshp-extension__count">{t('pluginsCount', { bundles: bundles.length, plugins: plugins.length })}</span>
        )}
        <span className="dshp-extension__spacer" />
        <Input
          className="dshp-extension__search"
          type="search"
          placeholder={t('pluginSearch')}
          aria-label={t('pluginSearch')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>

      {data === null && <p className="dshp-extension__empty">{t('loading')}</p>}
      {data !== null && bundles.length === 0 && <p className="dshp-extension__empty">{t('pluginEmpty')}</p>}
      {data !== null && bundles.length > 0 && visible.length === 0 && (
        <div className="dshp-extension__plugin-empty">
          <p className="dshp-extension__empty">{needle === '' ? t('pluginNoBundleMatch') : t('pluginNoMatch')}</p>
          {/* 筛选后为空时给一条退路；搜索后为空则只需要说明「没匹配」，不用建议切筛选。 */}
          {needle === '' && filter !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setFilter('all')}>{t('pluginShowAll')}</Button>
          )}
        </div>
      )}
      {visible.length > 0 && (
        <ul className="dshp-extension__plugin-bundles">
          {visible.map(bundle => (
            <PluginBundleCard
              key={bundle.name}
              t={t}
              bundle={bundle}
              resolveText={resolveText}
              busy={busy}
              expanded={expanded.has(bundle.name)}
              onToggleExpanded={() => toggleExpanded(bundle.name)}
              onToggleBundle={target => void doToggleBundle(target)}
              onToggleRow={row => void doToggleRow(row)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
