import type { ReactElement } from 'react'
import type { LocalizedTextView, PluginBundleView, PluginsListResponse, PluginToggleResponse, PluginUpdateCheckView, PluginUpdateResponse } from '../apis/index.type'
import type { Translate } from '../locales/index.types'
import type {
  PluginBundleCardProps,
  PluginFilter,
  PluginsTabProps,
  PluginUndoRecord,
  ResolveLocalizedText,
} from './plugins-tab.types'
import { Button, Icon, Input, Modal, Puzzle, SegmentedControl, StateDot, Switch, Tag } from 'dsh-tauri-ui/client'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, getPlugins, postPluginBundleToggle, postPluginRemove, postPluginUpdate, postPluginUpdateCheck } from '../apis'
import { PLUGIN_ID, PLUGIN_UPDATE_CHECK_TTL_MS } from '../constants'
import { useTimers } from '../hooks/use-timers'
import { PluginInstallDialog } from './plugins-install-dialog'
import { isCheckStale, registryUpdatableOf, sortBundlesByUpdate, updateBadgeOf, updatedCountOf } from './plugins-tab.update'

/**
 * 「检查更新」结果的内存缓存：**模块级**，跨组件重挂（切 tab、面板重进）都复用。
 *
 * 为什么不是组件 state：检查要串行问 registry（4 个包约 1–3 秒），每次重挂都重查既慢又吵；
 * 放模块级 + 10 分钟 TTL 才是「进页面自动查一次」的正确语义。用户想立刻确认就点「检查更新」。
 */
const updateCheckCache = new Map<string, { at: number, check: PluginUpdateCheckView }>()

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
 * 搜索面只有包本身：包名、标题、简介。
 *
 * 不再匹配包内模块名：这一页的可见对象只有包，搜得到却看不见的东西是最难解释的一类命中
 * （条目由官方「插件」页负责）。
 */
function bundleMatchesQuery(bundle: PluginBundleView, needle: string, resolveText?: ResolveLocalizedText): boolean {
  if (needle === '')
    return true
  return [bundle.name, bundleTitleOf(bundle, resolveText), bundleDescriptionOf(bundle, resolveText)]
    .some(value => value.toLowerCase().includes(needle))
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
 * 更新结果 → banner 文案。
 *
 * `ok` 只看最后一个执行步骤的结果；**`restore` 出现必须单独说一句**：那表示新版装失败、官方已经把
 * 旧版装回去了——不说明的话用户会以为「失败了但也许升上去了」。
 */
function updateOutcomeText(t: Translate, body: PluginUpdateResponse): string {
  if (body.ok)
    return t('pluginUpdateDone', { version: body.to ?? '' })
  const result = body.result
  const detail = [result?.errorCode ?? result?.failureKind ?? result?.application, result?.diagnostic]
    .filter(part => part !== undefined && part !== '')
    .join(' — ')
  const base = `${t('pluginUpdateFailed')}${detail === '' ? '' : ` (${detail})`}`
  return body.restore === undefined ? base : `${base} ${t('pluginUpdateRestored', { version: body.from ?? '' })}`
}

/**
 * 一个 npm 包（bundle）的卡片：图标 + 标题 + 一句话简介 + 版本 + 状态 + 包级开关 + 更新入口。
 *
 * 为什么以包为单位而不展开内部模块（2.3.0 用户定稿）：本机 200 多条 Loader 条目绝大多数是
 * DSH 自己的模块，铺开既看不出「装了什么」也没法批量管理；条目级的精细开关在官方「插件」页。
 */
export function PluginBundleCard({ t, bundle, resolveText, busy, update, updating, onToggleBundle, onUpdate, onRemove }: PluginBundleCardProps): ReactElement {
  const title = bundleTitleOf(bundle, resolveText)
  const description = bundleDescriptionOf(bundle, resolveText)
  const switchReason = bundleToggleReasonOf(t, bundle)
  return (
    <li
      className="dshp-extension__plugin-card"
      data-official={bundle.official ? 'true' : 'false'}
      data-enabled={bundle.enabled ? 'true' : 'false'}
      data-update={update === undefined ? 'false' : 'true'}
    >
      <span className="dshp-extension__plugin-card-icon" aria-hidden="true">
        {bundle.icon !== undefined && bundle.icon !== ''
          ? <img className="dshp-extension__plugin-card-img" src={bundle.icon} alt="" width={28} height={28} />
          : <Icon as={Puzzle} size={18} />}
      </span>
      <div className="dshp-extension__plugin-card-main">
        <div className="dshp-extension__plugin-card-title-row">
          {/* 全名（npm 包名）始终留在 title 上：标题是本地化文案，包名才是稳定标识。 */}
          <span className="dshp-extension__plugin-card-name" title={bundle.name}>{title}</span>
          {bundle.version !== undefined && bundle.version !== '' && (
            <span className="dshp-extension__plugin-card-version">{bundle.version}</span>
          )}
          <Tag tone={bundle.enabled ? 'neutral' : 'warning'}>{bundle.enabled ? t('pluginEnabled') : t('pluginDisabled')}</Tag>
          {switchReason !== undefined && <Tag tone="info">{switchReason}</Tag>}
          {bundle.errorCode !== undefined && bundle.errorCode !== '' && <Tag tone="danger">{bundle.errorCode}</Tag>}
          {update !== undefined && (
            <Tag tone="info">
              {update.from === undefined
                ? t('pluginUpdateAvailable')
                : t('pluginUpdateBadge', { from: update.from, to: update.to })}
            </Tag>
          )}
        </div>
        {description !== '' && <p className="dshp-extension__plugin-card-desc">{description}</p>}
        <div className="dshp-extension__plugin-card-meta">
          <Tag tone="outline">{bundle.official ? t('pluginsFilterOfficial') : t('pluginsFilterThirdParty')}</Tag>
          <span className="dshp-extension__plugin-card-pkg" title={bundle.name}>{bundle.name}</span>
          {/* `git` 依赖要一个钉到 full commit 的 spec，面板不自动查/更：给一句可执行的去处。 */}
          {bundle.update === 'git' && <span className="dshp-extension__plugin-card-pkg">{t('pluginUpdateGitManual')}</span>}
        </div>
      </div>
      {/*
        禁用态的 `<button>` 在 Chromium 里收不到鼠标事件、title 常不弹，所以原因同时挂在外层
        那个不会禁用的 span 上（与 restart-control.tsx 同一个坑）。
      */}
      {update !== undefined && onUpdate !== undefined && (
        <Button variant="ghost" size="sm" disabled={busy || updating} onClick={() => onUpdate(bundle, update.to)}>
          {updating ? t('pluginUpdating') : t('pluginUpdateTo', { version: update.to })}
        </Button>
      )}
      {/* 卸载入口只对官方说「可移除」的包渲染（随安装包提供的官方包 removable=false）。 */}
      {bundle.removable === true && onRemove !== undefined && (
        <Button variant="ghost" size="sm" disabled={busy || updating} onClick={() => onRemove(bundle)}>
          {t('pluginRemove')}
        </Button>
      )}
      <span className="dshp-extension__tip" title={switchReason}>
        <Switch
          checked={bundle.enabled}
          disabled={busy || updating || switchReason !== undefined}
          label={t('toggle')}
          title={switchReason}
          onChange={() => onToggleBundle(bundle)}
        />
      </span>
    </li>
  )
}

/**
 * 「插件」tab：以 **npm 包**为单位展示 + 包级启停 + 「安装插件」弹窗入口。
 *
 * 为什么自己不嵌官方页：官方插件页只导出 `NS/PANEL_ID/apply/inject`，没有组件也没有 `render()`，
 * 嵌不进来（spike-client §1.2）。数据、启停与安装都走宿主转发（`/api/plugins*`）；「插件市场」
 * 这个按钮已经换成「安装插件」弹窗（用户诉求：知道包名就能直接装），浏览/搜索仍交给官方的
 * 「发现」页——市场 UI 不可复用，复刻必然跟着索引格式漂移（§2.5）。
 */
export function PluginsTab({ t, openMarket, resolveText }: PluginsTabProps): ReactElement {
  const [data, setData] = useState<PluginsListResponse | null>(null)
  // 默认「第三方」：官方包会把这几个包淹掉，而用户要管的正是第三方那几个。
  const [filter, setFilter] = useState<PluginFilter>('third-party')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  // 「安装插件」是一个弹窗入口：知道包名的人输入包名就能装，浏览/搜索仍交给官方「发现」页。
  const [installOpen, setInstallOpen] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'info' | 'error', text: string } | null>(null)
  const [undo, setUndo] = useState<PluginUndoRecord | null>(null)
  // 检查更新：`checks` 是当前已知结论（含缓存里的），`checking` 只影响工具栏文案，不挡列表。
  const [checks, setChecks] = useState<Record<string, PluginUpdateCheckView>>({})
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  // 「更新到 x.y.z」先落到这里，再由确认弹窗决定要不要真跑。
  const [updateTarget, setUpdateTarget] = useState<{ bundle: PluginBundleView, to: string } | null>(null)
  const [updating, setUpdating] = useState(false)
  // 「卸载」同样要一次确认：官方语义是「取消选中 → pnpm remove → reload」，点错了包就没了。
  const [removeTarget, setRemoveTarget] = useState<PluginBundleView | null>(null)
  const [removing, setRemoving] = useState(false)
  const { mounted } = useTimers()

  useEffect(() => {
    let current = true
    void getPlugins().then(
      (body) => {
        if (!current)
          return
        // 宿主半与客户端半可以各自升级：缺字段时按空清单处理，而不是让整页在 `.filter` 上抛错。
        setData({ bundles: Array.isArray(body.bundles) ? body.bundles : [] })
      },
      (error: unknown) => {
        if (!current)
          return
        setData({ bundles: [] })
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
  const needle = query.trim().toLowerCase()
  const visible = bundles.filter(bundle => bundleMatchesFilter(bundle, filter) && bundleMatchesQuery(bundle, needle, resolveText))
  // 这一批里「按版本号可更新」的包：决定要不要查、以及工具栏状态怎么措辞。
  const updatableNames = useMemo(() => registryUpdatableOf(data?.bundles ?? []), [data])
  const updateCount = updatedCountOf(checks, updatableNames)
  // 有更新的置顶（用户定稿：只在整批检查结束后重排一次，不边到货边挪）；其余保持宿主顺序。
  const sortedVisible = sortBundlesByUpdate(visible, checks)

  const applyChecks = (list: readonly PluginUpdateCheckView[]): void => {
    if (list.length === 0)
      return
    const now = Date.now()
    for (const check of list)
      updateCheckCache.set(check.name, { at: now, check })
    setChecks((current) => {
      const next = { ...current }
      for (const check of list)
        next[check.name] = check
      return next
    })
  }

  /**
   * 跑一次批量检查。
   *
   * `manual` 只影响失败怎么表现：自动查失败**静默**（离线是常态，留一条红条只会让人以为面板坏了），
   * 手动查必须说清楚为什么没查到。
   */
  const runCheck = async (names: readonly string[], manual: boolean): Promise<void> => {
    if (names.length === 0)
      return
    setChecking(true)
    if (manual)
      setCheckError(null)
    try {
      const body = await postPluginUpdateCheck({ names: [...names] })
      if (!mounted.current)
        return
      applyChecks(Array.isArray(body.checks) ? body.checks : [])
    }
    catch (error) {
      if (!mounted.current)
        return
      if (manual) {
        setCheckError(`${t('pluginUpdateCheckFailed')}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    finally {
      if (mounted.current)
        setChecking(false)
    }
  }

  /**
   * 进页面自动查一次：先把缓存里**还新鲜**的结论贴上去（重挂时徽标立刻可见），再补查过期的。
   *
   * 依赖 `data` 而不是 `bundles`：后者每次渲染都是新数组，会让这个 effect 每帧都跑。
   */
  useEffect(() => {
    if (data === null)
      return
    const names = registryUpdatableOf(data.bundles)
    if (names.length === 0)
      return
    const now = Date.now()
    const cached: Record<string, PluginUpdateCheckView> = {}
    const pending: string[] = []
    for (const name of names) {
      const entry = updateCheckCache.get(name)
      if (isCheckStale(entry?.at, now, PLUGIN_UPDATE_CHECK_TTL_MS))
        pending.push(name)
      else if (entry !== undefined)
        cached[name] = entry.check
    }
    if (Object.keys(cached).length > 0)
      setChecks(current => ({ ...current, ...cached }))
    void runCheck(pending, false)
    // `runCheck` 每次渲染都是新函数，但它只读 state、不参与依赖；这里只按 `data` 触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  /** 执行卸载（确认之后）：成功后重拉列表，并清掉这一包的更新缓存。 */
  const doRemove = async (): Promise<void> => {
    const target = removeTarget
    if (target === null)
      return
    setRemoving(true)
    try {
      const body = await postPluginRemove({ name: target.name })
      if (!mounted.current)
        return
      // 与启停同一套 application 语义：`restart-required` 也算成功（官方会自己 reload / 等重启）。
      setBanner({
        ok: body.ok,
        text: body.ok
          ? `${t('pluginRemoved')}: ${bundleTitleOf(target, resolveText)}${body.application === 'restart-required' ? ` · ${t('pluginRestartRequired')}` : ''}`
          : `${t('pluginRemoveFailed')}${body.errorCode === undefined ? '' : ` (${body.errorCode})`}${body.diagnostic === undefined ? '' : ` — ${body.diagnostic}`}`,
      })
      if (body.ok) {
        setRemoveTarget(null)
        updateCheckCache.delete(target.name)
        setReload(value => value + 1)
      }
    }
    catch (error) {
      if (mounted.current)
        setBanner({ kind: 'error', text: failureTextOf(t, error) })
    }
    finally {
      if (mounted.current)
        setRemoving(false)
    }
  }

  /** 执行更新（确认之后才走到这里）：成功后清掉这一包的缓存并重拉列表。 */
  const doUpdate = async (): Promise<void> => {
    const target = updateTarget
    if (target === null)
      return
    const registry = checks[target.bundle.name]?.registry
    setUpdating(true)
    try {
      const body = await postPluginUpdate({
        name: target.bundle.name,
        version: target.to,
        ...(typeof registry === 'string' && registry !== '' ? { registry } : {}),
      })
      if (!mounted.current)
        return
      setBanner({ kind: body.ok ? 'ok' : 'error', text: updateOutcomeText(t, body) })
      if (body.ok) {
        setUpdateTarget(null)
        // 装完必须让下一次检查重新问：否则徽标还停在旧结论上，用户会以为「更新没生效」。
        updateCheckCache.delete(target.bundle.name)
        setChecks((current) => {
          const next = { ...current }
          delete next[target.bundle.name]
          return next
        })
        setReload(value => value + 1)
      }
    }
    catch (error) {
      if (mounted.current)
        setBanner({ kind: 'error', text: `${t('pluginUpdateFailed')}: ${error instanceof Error ? error.message : String(error)}` })
    }
    finally {
      if (mounted.current)
        setUpdating(false)
    }
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
    const record: PluginUndoRecord = { name: bundle.name, label: bundle.name, previousEnabled: bundle.enabled }
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

  /** 撤销 = 用同一条记录反向调一次；失败时保留记录，用户还能重试。 */
  const doUndo = async (): Promise<void> => {
    const record = undo
    if (record === null)
      return
    setBusy(true)
    try {
      const body = await postPluginBundleToggle({ name: record.name, enabled: record.previousEnabled })
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

  /** 工具栏右侧那句状态：只在「这一批真有可更新的包」时才说话，否则一句话都不占。 */
  const checkStatusText = (): string | null => {
    if (updatableNames.length === 0)
      return null
    if (checking)
      return t('pluginCheckingUpdates')
    if (checkError !== null)
      return checkError
    return updateCount > 0 ? t('pluginUpdatesAvailable', { count: updateCount }) : t('pluginUpToDate')
  }
  const statusText = checkStatusText()

  return (
    <div className="dshp-extension__section">
      <div className="dshp-extension__head">
        <span className="dshp-extension__head-icon"><Icon as={Puzzle} size={16} /></span>
        <h3>{t('pluginsTitle')}</h3>
        <span className="dshp-extension__spacer" />
        {updatableNames.length > 0 && (
          <Button variant="ghost" size="sm" disabled={busy || checking} onClick={() => void runCheck(updatableNames, true)}>
            {t('pluginCheckUpdates')}
          </Button>
        )}
        {/* 文字按钮而不是图标：右上角重启控件已经占了一个旋转图标，两个图标并排会认错。 */}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{t('refresh')}</Button>
        <Button variant="primary" size="sm" title={t('pluginInstallHint')} onClick={() => setInstallOpen(true)}>{t('pluginInstall')}</Button>
      </div>
      {/* 这段说明回答的是「为什么只有这么几个插件」：一个包可能含多条内部模块，条目级开关在官方页。 */}
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
          <span className="dshp-extension__count">{t('pluginsCount', { bundles: bundles.length })}</span>
        )}
        {statusText !== null && <span className="dshp-extension__count">{statusText}</span>}
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
      {sortedVisible.length > 0 && (
        <ul className="dshp-extension__plugin-bundles">
          {sortedVisible.map((bundle) => {
            const update = updateBadgeOf(bundle, checks[bundle.name])
            return (
              <PluginBundleCard
                key={bundle.name}
                t={t}
                bundle={bundle}
                resolveText={resolveText}
                busy={busy}
                {...update === undefined ? {} : { update }}
                updating={updating && updateTarget?.bundle.name === bundle.name}
                onToggleBundle={target => void doToggleBundle(target)}
                onUpdate={(target, version) => setUpdateTarget({ bundle: target, to: version })}
                // 自己（dsh-toolshed）不给卸载入口：官方可能把它算作可移除，卸掉面板当场消失、没有恢复入口。
                {...bundle.name === PLUGIN_ID ? {} : { onRemove: (target: PluginBundleView) => setRemoveTarget(target) }}
              />
            )
          })}
        </ul>
      )}
      {/*
        装完不关弹窗（用户要先看到结果），由这里重拉包列表：刚装的包可能还没进可见集
        （`bundle: false` 的包本来就不该出现），刷新后列表与磁盘一致即可。
      */}
      <PluginInstallDialog
        t={t}
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        openMarket={openMarket}
        onInstalled={() => setReload(value => value + 1)}
      />

      {/* 更新要**逐个确认**（用户定稿）：它会先卸旧版再装新版，误触的代价是插件短暂消失。 */}
      <Modal
        open={updateTarget !== null}
        onClose={() => { if (!updating) setUpdateTarget(null) }}
        closeLabel={t('close')}
        title={t('pluginUpdateTitle')}
        footer={(
          <>
            <Button variant="ghost" disabled={updating} onClick={() => setUpdateTarget(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={updating} onClick={() => void doUpdate()}>
              {updating ? t('pluginUpdating') : t('pluginUpdateConfirmAction')}
            </Button>
          </>
        )}
      >
        {updateTarget !== null && (
          <>
            <p>{t('pluginUpdateConfirm', { from: updateTarget.bundle.version ?? '', to: updateTarget.to })}</p>
            {typeof checks[updateTarget.bundle.name]?.registry === 'string' && (
              <p className="dshp-extension__intro">{t('pluginUpdateRegistry', { registry: String(checks[updateTarget.bundle.name]?.registry) })}</p>
            )}
          </>
        )}
      </Modal>

      {/* 卸载同样要确认：官方会先取消选中再 pnpm remove，点错包就真的没了。 */}
      <Modal
        open={removeTarget !== null}
        onClose={() => { if (!removing) setRemoveTarget(null) }}
        closeLabel={t('close')}
        title={t('pluginRemoveTitle')}
        footer={(
          <>
            <Button variant="ghost" disabled={removing} onClick={() => setRemoveTarget(null)}>{t('cancel')}</Button>
            <Button variant="danger" disabled={removing} onClick={() => void doRemove()}>
              {removing ? t('pluginRemoving') : t('pluginRemove')}
            </Button>
          </>
        )}
      >
        {removeTarget !== null && (
          <>
            <p>{t('pluginRemoveConfirm', { name: bundleTitleOf(removeTarget, resolveText) })}</p>
            <p className="dshp-extension__intro">{removeTarget.name}</p>
          </>
        )}
      </Modal>
    </div>
  )
}
