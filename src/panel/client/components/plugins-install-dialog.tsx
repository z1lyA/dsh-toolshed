import type { ReactElement } from 'react'
import type { PluginInstallResponse } from '../apis/index.type'
import type { Translate } from '../locales/index.types'
import type {
  PluginInstallDialogProps,
  PluginInstallPhase,
  PluginInstallResultProps,
  PluginInspectAccepted,
  PluginInspectRefused,
} from './plugins-install-dialog.types'
import { Button, Input, Modal, StateDot, Tag } from 'dsh-tauri-ui/client'
import { useState } from 'react'
import { ApiError, postPluginInspect, postPluginInstall } from '../apis'
import { useTimers } from '../hooks/use-timers'

/**
 * 安装规格的种类 → 一句话。
 *
 * 官方新增种类时原样透出机器码，不猜文案：猜错的解释比 `peer-link` 这种原词更难查。
 */
export function installKindTextOf(t: Translate, kind: string): string {
  if (kind === 'registry')
    return t('pluginInstallKindRegistry')
  if (kind === 'path')
    return t('pluginInstallKindPath')
  if (kind === 'git')
    return t('pluginInstallKindGit')
  if (kind === 'tarball')
    return t('pluginInstallKindTarball')
  return kind
}

/** 「是不是 DSH 插件包」的三种回答；`null` = 这种 spec 形式判断不了（git / tarball 要装完才知道）。 */
export function installBundleTextOf(t: Translate, bundle: boolean | null): string {
  if (bundle === true)
    return t('pluginInstallBundleYes')
  if (bundle === false)
    return t('pluginInstallBundleNo')
  return t('pluginInstallBundleUnknown')
}

/** 检查被拒的原因码 → 一句话（`problem` 是宿主定义的自由字符串）。 */
export function inspectProblemTextOf(t: Translate, problem: string): string {
  if (problem === 'invalid-spec')
    return t('pluginInstallProblemInvalidSpec')
  if (problem === 'already-installed')
    return t('pluginInstallProblemAlreadyInstalled')
  if (problem === 'not-found')
    return t('pluginInstallProblemNotFound')
  if (problem === 'not-a-package')
    return t('pluginInstallProblemNotAPackage')
  if (problem === 'not-a-bundle')
    return t('pluginInstallProblemNotABundle')
  if (problem === 'network')
    return t('pluginInstallProblemNetwork')
  if (problem === 'unknown')
    return t('pluginInstallProblemUnknown')
  return problem
}

/** 失败种类 → 一句话；缺席 = 官方没说，只能报「未知错误」（此时 pnpm 输出才是线索）。 */
export function installFailureTextOf(t: Translate, failureKind: string | undefined): string {
  if (failureKind === 'pnpm-missing')
    return t('pluginInstallFailurePnpmMissing')
  if (failureKind === 'timeout')
    return t('pluginInstallFailureTimeout')
  if (failureKind === 'not-found')
    return t('pluginInstallFailureNotFound')
  if (failureKind === 'no-matching-version')
    return t('pluginInstallFailureNoMatchingVersion')
  if (failureKind === 'network')
    return t('pluginInstallFailureNetwork')
  if (failureKind === 'disk-full')
    return t('pluginInstallFailureDiskFull')
  if (failureKind === 'permission')
    return t('pluginInstallFailurePermission')
  if (failureKind === 'build-blocked')
    return t('pluginInstallFailureBuildBlocked')
  if (failureKind === 'integrity')
    return t('pluginInstallFailureIntegrity')
  if (failureKind === undefined || failureKind === '')
    return t('pluginInstallFailureUnknown')
  return failureKind
}

/**
 * 安装的 `application` → 一句话。
 *
 * 与启停共用同一套语义，所以复用启停那三个键：`restart-required` 时必须如实说「要重启」，
 * 否则用户会去插件列表里找一个还不会被加载的包。
 */
export function installOutcomeTextOf(t: Translate, application: string): string {
  if (application === 'applied')
    return t('pluginApplied')
  if (application === 'restart-required')
    return t('pluginRestartRequired')
  if (application === 'overridden')
    return t('pluginOverridden')
  return application
}

/**
 * 请求本身失败（网络 / 503 / 非 2xx）时的一句话。
 *
 * 与「官方说装不了」分开：`PluginInstallResponse.ok === false` 是官方给的结论（带 failureKind），
 * 这里处理连结论都没拿到的情形。503 是「这个部署没有插件管理」，要能直接回答「为什么装不了」。
 */
function transportTextOf(t: Translate, cause: unknown): string {
  const failed = t('failed')
  if (cause instanceof ApiError) {
    if (cause.code === 'plugin-manager-unavailable')
      return t('pluginUnavailable')
    return `${failed}: ${cause.message} (${cause.code ?? `HTTP ${cause.status}`})`
  }
  return `${failed}: ${cause instanceof Error ? cause.message : String(cause)}`
}

/** `包名@版本`，缺哪一半就只显示另一半。 */
function packageLabelOf(name: string | undefined, version: string | undefined, fallback: string): string {
  const label = name !== undefined && name !== '' ? name : fallback
  return version !== undefined && version !== '' ? `${label}@${version}` : label
}

/**
 * 弹窗的结果区（纯展示）。
 *
 * 每个分支只回答一个问题（正在查 / 能不能装 / 为什么不能 / 正在装 / 要批准 / 装好了 / 为什么失败）：
 * 安装是不可撤销的外部副作用，含糊的「成功/失败」二态会让用户重复装。
 */
export function PluginInstallResult(props: PluginInstallResultProps): ReactElement | null {
  const { t, phase, inspect, refused, result, pending, errorText, busy, onApprove, spec } = props

  if (phase === 'checking') {
    return (
      <div className="dshp-extension__plugin-install-state" role="status">
        <StateDot state="ongoing" size={10} />
        <span>{t('pluginInstallChecking')}</span>
      </div>
    )
  }

  if (phase === 'accepted') {
    return (
      <div className="dshp-extension__plugin-install-result" data-kind="ok" role="status">
        <div className="dshp-extension__card-top">
          <StateDot state="done" size={10} />
          <strong>{t('pluginInstallAcceptedTitle')}</strong>
          {inspect !== null && <Tag tone="info">{installKindTextOf(t, inspect.kind)}</Tag>}
        </div>
        <span className="dshp-extension__plugin-install-name" title={packageLabelOf(inspect?.name, inspect?.version, spec)}>
          {packageLabelOf(inspect?.name, inspect?.version, spec)}
        </span>
        {inspect !== null && inspect.description !== undefined && inspect.description !== '' && (
          <p className="dshp-extension__plugin-install-note">{inspect.description}</p>
        )}
        {/* `bundle === false` 是这一页最重要的一句真话：装完不会出现在上面的卡片列表里。 */}
        <p className="dshp-extension__plugin-install-note" data-bundle={inspect?.bundle === true ? 'true' : inspect?.bundle === false ? 'false' : 'unknown'}>
          {installBundleTextOf(t, inspect === null ? null : inspect.bundle)}
        </p>
      </div>
    )
  }

  if (phase === 'refused') {
    return (
      <div className="dshp-extension__plugin-install-result" data-kind="error" role="status">
        <div className="dshp-extension__card-top">
          <StateDot state="error" size={10} />
          <strong>{t('pluginInstallRefusedTitle')}</strong>
        </div>
        {errorText !== null && <p className="dshp-extension__form-error">{errorText}</p>}
        {errorText === null && refused !== null && (
          <>
            <p className="dshp-extension__plugin-install-note">{inspectProblemTextOf(t, refused.problem)}</p>
            {/* 原话收在折叠里：pnpm / registry 的报错通常很长，但它才是能贴进 issue 的证据。 */}
            {refused.reason !== undefined && refused.reason !== '' && (
              <details className="dshp-extension__plugin-install-details">
                <summary>{t('pluginInstallReason')}</summary>
                <pre className="dshp-extension__plugin-install-output">{refused.reason}</pre>
              </details>
            )}
          </>
        )}
      </div>
    )
  }

  if (phase === 'installing') {
    return (
      <div className="dshp-extension__plugin-install-state" role="status">
        <StateDot state="ongoing" size={10} />
        <span>{t('pluginInstallInstalling')}</span>
      </div>
    )
  }

  if (phase === 'pending-builds') {
    return (
      <div className="dshp-extension__plugin-install-result" data-kind="warn" role="status">
        <div className="dshp-extension__card-top">
          <StateDot state="ongoing" size={10} />
          <strong>{t('pluginInstallPendingTitle')}</strong>
        </div>
        <ul className="dshp-extension__plugin-install-builds">
          {pending.map(name => <li key={name}>{name}</li>)}
        </ul>
        <p className="dshp-extension__plugin-install-note">{t('pluginInstallPendingHint')}</p>
        <div className="dshp-extension__card-row">
          <Button variant="primary" size="sm" disabled={busy} onClick={onApprove}>{t('pluginInstallApprove')}</Button>
        </div>
      </div>
    )
  }

  if (phase === 'installed') {
    return (
      <div className="dshp-extension__plugin-install-result" data-kind="ok" role="status">
        <div className="dshp-extension__card-top">
          <StateDot state="done" size={10} />
          <strong>{t('pluginInstallInstalledTitle')}</strong>
          {result !== null && <Tag tone="neutral">{installOutcomeTextOf(t, result.application)}</Tag>}
        </div>
        <span className="dshp-extension__plugin-install-name">
          {packageLabelOf(result?.bundle ?? inspect?.name, result?.version ?? inspect?.version, spec)}
        </span>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="dshp-extension__plugin-install-result" data-kind="error" role="status">
        <div className="dshp-extension__card-top">
          <StateDot state="error" size={10} />
          <strong>{t('pluginInstallFailedTitle')}</strong>
          {result !== null && result.errorCode !== undefined && result.errorCode !== '' && <Tag tone="danger">{result.errorCode}</Tag>}
        </div>
        {result !== null && <p className="dshp-extension__plugin-install-note">{installFailureTextOf(t, result.failureKind)}</p>}
        {result !== null && result.diagnostic !== undefined && result.diagnostic !== '' && (
          <p className="dshp-extension__plugin-install-note">{result.diagnostic}</p>
        )}
        {errorText !== null && <p className="dshp-extension__form-error">{errorText}</p>}
        {/* pnpm 输出的尾部是失败时唯一能定位原因的线索：限高滚动，别把弹窗撑成一整页日志。 */}
        {result !== null && result.output !== undefined && result.output !== '' && (
          <div className="dshp-extension__plugin-install-block">
            <span className="dshp-extension__plugin-install-label">{t('pluginInstallOutput')}</span>
            <pre className="dshp-extension__plugin-install-output">{result.output}</pre>
          </div>
        )}
      </div>
    )
  }

  return null
}

/**
 * 「安装插件」弹窗：输入 spec → 检查 → 安装，批准构建脚本时分两轮。
 *
 * 为什么不做市场索引/搜索/详情：那是官方「发现」页的职责（它只注册了 `plugins.tab`，没有可复用组件），
 * 复刻必然跟着索引格式漂移。这里只提供一条确定的路径：知道包名的人输入包名就能装；
 * 浏览/搜索点底部的「打开官方插件市场」。
 */
export function PluginInstallDialog({ t, open, onClose, onInstalled, openMarket }: PluginInstallDialogProps): ReactElement {
  const [spec, setSpec] = useState('')
  const [phase, setPhase] = useState<PluginInstallPhase>('idle')
  const [inspect, setInspect] = useState<PluginInspectAccepted | null>(null)
  const [refused, setRefused] = useState<PluginInspectRefused | null>(null)
  const [result, setResult] = useState<PluginInstallResponse | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const [errorText, setErrorText] = useState<string | null>(null)
  const { mounted } = useTimers()

  const trimmed = spec.trim()
  const busy = phase === 'checking' || phase === 'installing'

  /** 换 spec 就把上一次的结论清掉：旧结论挂在新输入上是最容易误装的坑。 */
  const resetOutcome = (): void => {
    setInspect(null)
    setRefused(null)
    setResult(null)
    setPending([])
    setErrorText(null)
  }

  const doCheck = async (): Promise<void> => {
    if (busy || trimmed === '')
      return
    resetOutcome()
    setPhase('checking')
    try {
      const body = await postPluginInspect({ spec: trimmed })
      if (!mounted.current)
        return
      // `strict: false` 下联合不按字面量收窄，显式断言一次（同 plugins-tab 的写法）。
      if (body.status === 'accepted') {
        setInspect(body as PluginInspectAccepted)
        setPhase('accepted')
      }
      else {
        setRefused(body as PluginInspectRefused)
        setPhase('refused')
      }
    }
    catch (error) {
      if (!mounted.current)
        return
      setErrorText(transportTextOf(t, error))
      setPhase('refused')
    }
  }

  /** `approvedBuilds` 只有「允许并继续」那一轮才带；第一轮什么都不带（官方会先报 pendingBuilds）。 */
  const doInstall = async (approvedBuilds?: string[]): Promise<void> => {
    if (busy || trimmed === '')
      return
    setErrorText(null)
    setPhase('installing')
    try {
      const body = await postPluginInstall(approvedBuilds === undefined ? { spec: trimmed } : { spec: trimmed, approvedBuilds })
      if (!mounted.current)
        return
      const builds = Array.isArray(body.pendingBuilds)
        ? body.pendingBuilds.filter(name => typeof name === 'string' && name !== '')
        : []
      // pendingBuilds 非空 = 这一轮什么都没装：先让用户看清单，别显示成「失败」。
      if (builds.length > 0) {
        setPending(builds)
        setPhase('pending-builds')
        return
      }
      setPending([])
      setResult(body)
      if (body.ok === true) {
        setPhase('installed')
        onInstalled?.()
      }
      else {
        setPhase('failed')
      }
    }
    catch (error) {
      if (!mounted.current)
        return
      setResult(null)
      setErrorText(transportTextOf(t, error))
      setPhase('failed')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('pluginInstall')}
      className="dshp-extension dshp-extension__modal-form"
      contentClassName="dshp-extension__modal-scroll"
    >
      {/* 关闭态不渲染表单：开关归原语管，空表单留在树里只会让 SSR/离屏断言混进关闭态的内容。 */}
      {open && (
        <div className="dshp-extension__form">
          <p className="dshp-extension__intro">{t('pluginInstallIntro')}</p>
          <label className="dshp-extension__label">
            <span>{t('pluginInstallSpecLabel')}</span>
            <Input
              autoFocus
              aria-label={t('pluginInstallSpecLabel')}
              placeholder={t('pluginInstallPlaceholder')}
              value={spec}
              disabled={busy}
              onChange={(event) => {
                setSpec(event.target.value)
                resetOutcome()
                setPhase('idle')
              }}
              onKeyDown={(event) => {
                // 回车 = 检查：这是「知道包名的人」最顺的一条路径。
                if (event.key === 'Enter')
                  void doCheck()
              }}
            />
          </label>

          <PluginInstallResult
            t={t}
            phase={phase}
            inspect={inspect}
            refused={refused}
            result={result}
            pending={pending}
            errorText={errorText}
            busy={busy}
            spec={trimmed}
            onApprove={() => void doInstall(pending)}
          />

          <div className="dshp-extension__card-row">
            <span className="dshp-extension__spacer" />
            <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
            <Button
              variant="ghost"
              disabled={busy || trimmed === ''}
              title={trimmed === '' ? t('pluginInstallEmptySpec') : undefined}
              onClick={() => void doCheck()}
            >
              {t('pluginInstallCheck')}
            </Button>
            {/* 只有检查通过才允许装：检查被拒（包不存在 / 已经装过）时再跑一遍 pnpm 只是白等几十秒。 */}
            <Button variant="primary" disabled={busy || phase !== 'accepted'} onClick={() => void doInstall()}>
              {t('pluginInstallDo')}
            </Button>
          </div>

          {openMarket !== undefined && (
            <div className="dshp-extension__card-row">
              <Button variant="ghost" size="sm" title={t('pluginMarketHint')} onClick={openMarket}>{t('pluginInstallMarket')}</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
