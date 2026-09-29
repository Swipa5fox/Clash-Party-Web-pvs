import { execFile } from 'child_process'
import { promisify } from 'util'
import { initI18n } from '../shared/i18n'
import { asyncHandlers, syncHandlers } from './utils/ipc'
import { getAppConfig, patchAppConfig } from './config'
import {
  beginCoreInitialization,
  completeCoreInitialization,
  startCoreForStartup,
  validateTunPermissionsOnStartup,
  checkHighPrivilegeCore,
  initAdminStatus,
  checkAdminPrivileges,
  initCoreWatcher
} from './core/manager'
import { startWebBridge, createRpcRouter, WEB_BLOCKED_CHANNELS } from './resolve/webBridge'
import { broadcastEvent, setBroadcaster } from './resolve/broadcaster'
import { safeShowErrorBox, init, initBasic } from './utils/init'
import { initProfileUpdater } from './core/profileUpdater'
import { createLogger } from './utils/logger'
import { initWebdavBackupScheduler } from './resolve/backup'
import { setupLifecycle } from './lifecycle'
import { configureAppPaths } from './utils/dirs'
import { rendererRoot, systemLocale } from './runtime'

// 纯 Node 服务器入口：无窗口无托盘，唯一 UI 出口是 :3999 WS 桥。

async function getWindowsPowerShellMajorVersion(): Promise<number | null> {
  // 仅 PS 3.0+ 写入 \3\ 键（\1\ 键恒为 2.0，不可用）。
  try {
    const { stdout } = await promisify(execFile)(
      'reg',
      [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\3\\PowerShellEngine',
        '/v',
        'PowerShellVersion'
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    const version = stdout.match(/PowerShellVersion\s+REG_\w+\s+([^\s]+)/)?.[1]
    const major = version ? parseInt(version.split('.')[0], 10) : NaN
    return isNaN(major) ? null : major
  } catch (error) {
    // 退出码 1 = 键不存在（老旧系统仅 PS 2.0）；超时被杀或其他异常视为未知，不阻断。
    const err = error as { killed?: boolean; code?: number | string }
    return !err.killed && err.code === 1 ? 2 : null
  }
}

// 尽早并行检查，不阻塞服务初始化。
const windowsPowerShellVersionPromise =
  process.platform === 'win32' ? getWindowsPowerShellMajorVersion() : Promise.resolve(null)

// PS 5.1 以下仅告警不阻断（老系统提示装 WMF 5.1）。
async function warnOnOldWindowsPowerShell(): Promise<void> {
  const major = await windowsPowerShellVersionPromise
  if (major === null || major >= 5) return

  const isZh = Intl.DateTimeFormat().resolvedOptions().locale?.startsWith('zh')
  mainLogger.warn(
    isZh
      ? `检测到 PowerShell 版本为 ${major}.x，部分功能需要 PowerShell 5.1 才能正常运行，请安装 Windows Management Framework 5.1`
      : `Detected PowerShell version ${major}.x. Some features require PowerShell 5.1 (Windows Management Framework 5.1).`
  )
}

configureAppPaths()

const mainLogger = createLogger('Main')

async function main(): Promise<void> {
  setupLifecycle()

  try {
    await initBasic()
    const cfg = await getAppConfig()
    if (!cfg.language) {
      const systemLanguage = systemLocale()
      await patchAppConfig({ language: systemLanguage })
      cfg.language = systemLanguage
    }
    await initI18n({ lng: cfg.language })
  } catch (e) {
    safeShowErrorBox('common.error.initFailed', `${e}`)
    process.exit(1)
  }

  beginCoreInitialization()

  const adminPromise: Promise<boolean> =
    process.platform === 'win32' ? checkAdminPrivileges().catch(() => false) : Promise.resolve(true)

  // 安全检查尽早并行执行，但只用一个布尔 gate 控制核心启动。
  const startupSafetyPromise = (async (): Promise<boolean> => {
    const isAdmin = await adminPromise
    await initAdminStatus()
    await warnOnOldWindowsPowerShell()

    // high-privilege core 检查：headless 下无宿主弹窗与 admin 重启交互，
    // 仅保留纯检测（checkHighPrivilegeCore）并记录日志，进程不退出。
    if (!isAdmin) {
      try {
        if (await checkHighPrivilegeCore()) {
          mainLogger.warn(
            '[web] high-privilege residual core detected; continuing without host dialog or admin restart'
          )
        }
      } catch (e) {
        mainLogger.error('[web] Failed to check high privilege core', e)
      }
    }
    return true
  })().catch((error) => {
    mainLogger.error('Startup safety checks failed', error)
    return false
  })

  const bridge = await startWebBridge({
    staticRoot: rendererRoot(),
    // dev 注入 CP_RENDERER_URL 时 web 桥反代 Vite dev server；生产走静态产物。
    devServerUrl: process.env.CP_RENDERER_URL,
    rpc: createRpcRouter(asyncHandlers, syncHandlers, WEB_BLOCKED_CHANNELS)
  })
  // 主进程事件推送出口接到 WS 桥（替代原 setMainWindowStub(bridge.broadcast)）
  setBroadcaster(bridge.broadcast)
  const host = process.env.CP_WEB_HOST || '0.0.0.0'
  // 账号密码登录（初始账号 admin，凭据哈希存 dataDir/web-auth.json，首次启动自动生成）
  // stdout 是服务器场景下唯一的启动提示通道（systemd journal 收录）
  // eslint-disable-next-line no-console
  console.log(`[web] Clash Party Web UI: http://${host}:${bridge.port}`)

  // 后台服务初始化（PAC/sysproxy/SSID 巡检等）与核心启动并行。
  const runtimeInitPromise = startupSafetyPromise
    .then(async (canContinue) => {
      if (!canContinue) return
      await init()
    })
    .catch((error) => {
      mainLogger.error('Failed to initialize background services', error)
    })

  let coreStarted = false
  const coreStartPromise = (async (): Promise<void> => {
    if (!(await startupSafetyPromise)) {
      completeCoreInitialization(false)
      return
    }

    try {
      initCoreWatcher()
      const startPromises = await startCoreForStartup()
      if (startPromises.length > 0) {
        startPromises[0].then(async () => {
          await Promise.allSettled([
            initProfileUpdater().catch((e) => mainLogger.warn('Failed to init profile updater', e)),
            initWebdavBackupScheduler().catch((e) =>
              mainLogger.warn('Failed to init webdav backup scheduler', e)
            ),
            validateTunPermissionsOnStartup().catch((e) =>
              mainLogger.warn('Failed TUN permission startup check', e)
            )
          ])
        })
      }
      coreStarted = true
    } catch (e) {
      safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
    } finally {
      // 安全检查通过后，即使自动启动失败，也允许用户手动重试。
      completeCoreInitialization(true)
    }
  })()

  void runtimeInitPromise
  await coreStartPromise

  if (coreStarted) {
    // 通知已连接的 Web 客户端核心就绪
    broadcastEvent('core-started')
  }
}

main().catch((error) => {
  console.error('[main] Application startup failed:', error)
  mainLogger.error('Application startup failed', error)
  safeShowErrorBox('common.error.initFailed', `${error}`)
  process.exit(1)
})
