import type { PluginInstallResultProps } from './plugins-install-dialog.types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { locale } from '../locales'
import {
  inspectProblemTextOf,
  installBundleTextOf,
  installFailureTextOf,
  installKindTextOf,
  installOutcomeTextOf,
  PluginInstallDialog,
  PluginInstallResult,
} from './plugins-install-dialog'

/**
 * 「安装插件」弹窗的渲染冒烟。
 *
 * 同 `plugins-tab.render.test.tsx`：`renderToStaticMarkup` 不跑 effect、也点不了按钮，所以状态机本身
 * 走不到第 2 格。覆盖办法是把**结果区**（`PluginInstallResult`）单独导出，逐个 `phase` 喂 props——
 * 这正好是「缺字段会不会渲染出 undefined」「文案键有没有漏」最容易出错的地方。
 */
const t = locale.text
const noop = (): void => {}

const base: PluginInstallResultProps = {
  t,
  phase: 'idle',
  inspect: null,
  refused: null,
  result: null,
  pending: [],
  errorText: null,
  busy: false,
  spec: 'dsh-plugin-foo',
  onApprove: noop,
}

function resultOf(overrides: Partial<PluginInstallResultProps>): string {
  return renderToStaticMarkup(<PluginInstallResult {...base} {...overrides} />)
}

describe('安装插件弹窗（输入态）', () => {
  it('展开时：说明、标签、输入框、检查与安装都在；不再有「打开官方插件市场」那一行', () => {
    const html = renderToStaticMarkup(<PluginInstallDialog t={t} open onClose={noop} />)

    expect(html).toContain(t('pluginInstallIntro'))
    expect(html).toContain(t('pluginInstallSpecLabel'))
    // 输入框替身只保留 data-prim；「空输入时两个动作都禁用」用按钮上的原因文案断言。
    expect(html).toContain('data-prim="Input"')
    expect(html).toContain(t('pluginInstallEmptySpec'))
    expect(html).toContain(t('pluginInstallCheck'))
    expect(html).toContain(t('pluginInstallDo'))
    // 2.9.1：官方页入口统一挪到工具栏的「官方插件页」，弹窗里那一行删掉（用户要求，避免重复）。
    expect(html).not.toContain(t('pluginInstallMarket'))
    // 弹窗替身只渲染 children，不转发 className —— 容器/滚动 class 只在真机可见，这里不硬断。
    // 空输入 + 还没检查：两个动作都禁用（避免跑一次注定失败的 pnpm）。
    expect(html).toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })

  it('关闭态不渲染表单内容（弹窗开关归原语管，树里不必留一份空表单）', () => {
    const html = renderToStaticMarkup(<PluginInstallDialog t={t} open={false} onClose={noop} />)

    expect(html).not.toContain(t('pluginInstallIntro'))
    expect(html).not.toContain('data-prim="Input"')
    expect(html).not.toContain('undefined')
  })
})

describe('安装插件弹窗（检查结果）', () => {
  it('checking：转圈 + 「正在检查…」', () => {
    const html = resultOf({ phase: 'checking' })

    expect(html).toContain(t('pluginInstallChecking'))
    expect(html).toContain('dshp-extension__plugin-install-state')
    expect(html).not.toContain('undefined')
  })

  it('accepted：包名 + 版本 + 简介 + 种类 + 「这是一个 bundle」', () => {
    const html = resultOf({
      phase: 'accepted',
      inspect: {
        status: 'accepted',
        kind: 'registry',
        name: 'dsh-plugin-foo',
        version: '1.2.3',
        description: '一句话简介',
        bundle: true,
      },
    })

    expect(html).toContain(t('pluginInstallAcceptedTitle'))
    expect(html).toContain('dsh-plugin-foo@1.2.3')
    expect(html).toContain('一句话简介')
    expect(html).toContain(t('pluginInstallKindRegistry'))
    expect(html).toContain(t('pluginInstallBundleYes'))
    expect(html).toContain('data-bundle="true"')
    expect(html).not.toContain('undefined')
  })

  it('accepted + bundle=false：明确说「装了也不会出现在插件列表」', () => {
    const html = resultOf({
      phase: 'accepted',
      inspect: { status: 'accepted', kind: 'git', bundle: false },
    })

    // 没有包名时用用户输入的 spec 兜底：git 形式官方读不到 manifest。
    expect(html).toContain('dsh-plugin-foo')
    expect(html).toContain(t('pluginInstallBundleNo'))
    expect(html).toContain('data-bundle="false"')
    expect(html).not.toContain('undefined')
  })

  it('accepted + bundle=null：只说「装完才能确认」，不猜', () => {
    const html = resultOf({
      phase: 'accepted',
      inspect: { status: 'accepted', kind: 'tarball', bundle: null },
    })

    expect(html).toContain(t('pluginInstallBundleUnknown'))
    expect(html).toContain('data-bundle="unknown"')
    expect(html).not.toContain('undefined')
  })

  it('refused：一句话结论 + 可折叠的原始原因', () => {
    const reason = '404 Not Found - GET https://registry.npmjs.org/dsh-plugin-foo'
    const html = resultOf({
      phase: 'refused',
      refused: { status: 'refused', problem: 'not-found', reason },
    })

    expect(html).toContain(t('pluginInstallRefusedTitle'))
    expect(html).toContain(t('pluginInstallProblemNotFound'))
    expect(html).toContain('<details')
    expect(html).toContain(t('pluginInstallReason'))
    expect(html).toContain(reason)
    expect(html).not.toContain('undefined')
  })

  it('refused 的未知问题码原样透出，不猜文案', () => {
    const html = resultOf({
      phase: 'refused',
      refused: { status: 'refused', problem: 'some-future-problem', reason: 'x' },
    })

    expect(html).toContain('some-future-problem')
    expect(html).not.toContain('undefined')
  })

  it('请求本身失败（503 等）：只显示那句话，不伪造 problem', () => {
    const html = resultOf({ phase: 'refused', errorText: t('pluginUnavailable') })

    expect(html).toContain(t('pluginUnavailable'))
    expect(html).toContain('dshp-extension__form-error')
    expect(html).not.toContain('undefined')
  })
})

describe('安装插件弹窗（安装结果）', () => {
  it('installing：转圈 + 「会跑 pnpm」的预期管理', () => {
    const html = resultOf({ phase: 'installing' })

    expect(html).toContain(t('pluginInstallInstalling'))
    expect(html).toContain('dshp-extension__plugin-install-state')
    expect(html).not.toContain('undefined')
  })

  it('pendingBuilds：列出包名 + 「允许并继续」', () => {
    const html = resultOf({ phase: 'pending-builds', pending: ['esbuild', 'sharp'] })

    expect(html).toContain(t('pluginInstallPendingTitle'))
    expect(html).toContain('esbuild')
    expect(html).toContain('sharp')
    expect(html).toContain(t('pluginInstallPendingHint'))
    expect(html).toContain(t('pluginInstallApprove'))
    expect(html).not.toContain('undefined')
  })

  it('pendingBuilds 时按钮跟着忙态禁用', () => {
    const html = resultOf({ phase: 'pending-builds', pending: ['esbuild'], busy: true })

    expect(html).toContain(t('pluginInstallApprove'))
    expect(html).toContain('data-disabled="true"')
    expect(html).not.toContain('undefined')
  })

  it('installed：bundle@version + 如实说明要重启', () => {
    const html = resultOf({
      phase: 'installed',
      result: {
        ok: true,
        application: 'restart-required',
        changed: true,
        bundle: 'dsh-plugin-foo',
        version: '1.2.3',
      },
    })

    expect(html).toContain(t('pluginInstallInstalledTitle'))
    expect(html).toContain('dsh-plugin-foo@1.2.3')
    expect(html).toContain(t('pluginRestartRequired'))
    expect(html).not.toContain('undefined')
  })

  it('failed：失败种类 + errorCode + diagnostic + 限高滚动的 pnpm 输出', () => {
    const output = 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/x: Not Found'
    const html = resultOf({
      phase: 'failed',
      result: {
        ok: false,
        application: 'failed',
        changed: false,
        errorCode: 'ERR_PNPM_FETCH_404',
        diagnostic: 'pnpm exited with code 1',
        failureKind: 'not-found',
        output,
      },
    })

    expect(html).toContain(t('pluginInstallFailedTitle'))
    expect(html).toContain(t('pluginInstallFailureNotFound'))
    expect(html).toContain('ERR_PNPM_FETCH_404')
    expect(html).toContain('pnpm exited with code 1')
    expect(html).toContain(t('pluginInstallOutput'))
    expect(html).toContain('<pre class="dshp-extension__plugin-install-output"')
    expect(html).toContain('ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/x: Not Found')
    expect(html).not.toContain('undefined')
  })

  it('failed 且官方什么都没说：报「未知错误」，不显示 undefined', () => {
    const html = resultOf({ phase: 'failed', result: { ok: false, application: 'failed', changed: false } })

    expect(html).toContain(t('pluginInstallFailureUnknown'))
    expect(html).not.toContain('undefined')
  })

  it('idle：结果区什么都不渲染', () => {
    expect(resultOf({ phase: 'idle' })).toBe('')
  })
})

describe('结果码 → 文案', () => {
  it('规格种类：四个已知种类有译文，未知原样透出', () => {
    expect(installKindTextOf(t, 'registry')).toBe(t('pluginInstallKindRegistry'))
    expect(installKindTextOf(t, 'path')).toBe(t('pluginInstallKindPath'))
    expect(installKindTextOf(t, 'git')).toBe(t('pluginInstallKindGit'))
    expect(installKindTextOf(t, 'tarball')).toBe(t('pluginInstallKindTarball'))
    expect(installKindTextOf(t, 'workspace-protocol')).toBe('workspace-protocol')
  })

  it('bundle 三态各有各的说法', () => {
    expect(installBundleTextOf(t, true)).toBe(t('pluginInstallBundleYes'))
    expect(installBundleTextOf(t, false)).toBe(t('pluginInstallBundleNo'))
    expect(installBundleTextOf(t, null)).toBe(t('pluginInstallBundleUnknown'))
  })

  it('检查被拒的原因码：已知都有译文，未知原样透出', () => {
    for (const [problem, key] of [
      ['invalid-spec', 'pluginInstallProblemInvalidSpec'],
      ['already-installed', 'pluginInstallProblemAlreadyInstalled'],
      ['not-found', 'pluginInstallProblemNotFound'],
      ['not-a-package', 'pluginInstallProblemNotAPackage'],
      ['not-a-bundle', 'pluginInstallProblemNotABundle'],
      ['network', 'pluginInstallProblemNetwork'],
      ['unknown', 'pluginInstallProblemUnknown'],
    ] as const)
      expect(inspectProblemTextOf(t, problem), problem).toBe(t(key))
    expect(inspectProblemTextOf(t, 'future-code')).toBe('future-code')
  })

  it('失败种类：十个已知都有译文，缺席时是「未知错误」，未知码原样透出', () => {
    for (const [kind, key] of [
      ['pnpm-missing', 'pluginInstallFailurePnpmMissing'],
      ['timeout', 'pluginInstallFailureTimeout'],
      ['not-found', 'pluginInstallFailureNotFound'],
      ['no-matching-version', 'pluginInstallFailureNoMatchingVersion'],
      ['network', 'pluginInstallFailureNetwork'],
      ['disk-full', 'pluginInstallFailureDiskFull'],
      ['permission', 'pluginInstallFailurePermission'],
      ['build-blocked', 'pluginInstallFailureBuildBlocked'],
      ['integrity', 'pluginInstallFailureIntegrity'],
    ] as const)
      expect(installFailureTextOf(t, kind), kind).toBe(t(key))
    expect(installFailureTextOf(t, undefined)).toBe(t('pluginInstallFailureUnknown'))
    expect(installFailureTextOf(t, '')).toBe(t('pluginInstallFailureUnknown'))
    expect(installFailureTextOf(t, 'future-kind')).toBe('future-kind')
  })

  it('application 语义与启停共用同一套文案', () => {
    expect(installOutcomeTextOf(t, 'applied')).toBe(t('pluginApplied'))
    expect(installOutcomeTextOf(t, 'restart-required')).toBe(t('pluginRestartRequired'))
    expect(installOutcomeTextOf(t, 'overridden')).toBe(t('pluginOverridden'))
    expect(installOutcomeTextOf(t, 'cancelled')).toBe('cancelled')
  })
})
