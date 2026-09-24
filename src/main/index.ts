import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'
import { electronApp } from '@electron-toolkit/utils'
import { app, ipcMain } from 'electron'
import { initI18n } from '../shared/i18n'
import { asyncHandlers, registerIpcMainHandlers, syncHandlers } from './utils/ipc'
import { getAppConfig, patchAppConfig } from './config'
import {
  beginCoreInitialization,
  completeCoreInitialization,
  startCoreForStartup,
  checkAdminRestartForTun,
  checkHighPrivilegeCore,
  initAdminStatus,
  checkAdminPrivileges,
  initCoreWatcher
} from './core/manager'
import { startWebBridge, createRpcRouter, WEB_BLOCKED_CHANNELS } from './resolve/webBridge'
import { broadcastEvent, setBroadcaster } from './resolve/broadcaster'
import { init, initBasic, safeShowErrorBox } from './utils/init'
import { initProfileUpdater } from './core/profileUpdater'
import { createLogger } from './utils/logger'
import { initWebdavBackupScheduler } from './resolve/backup'
import { setupPlatformSpecifics, setupAppLifecycle, getSystemLanguage } from './lifecycle'
import { configureAppPaths } from './utils/dirs'

// Web-Only 启动编排：仍以 Electron 运行时承载（app.whenReady 等），
// 但全程无 BrowserWindow/托盘/快捷键，唯一 UI 出口是 :3999 WS 桥。

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

// 尽早并行检查，不阻塞 Electron 初始化。
const windowsPowerShellVersionPromise =
  process.platform === 'win32' ? getWindowsPowerShellMajorVersion() : Promise.resolve(null)

async function ensureSupportedWindowsPowerShell(): Promise<boolean> {
  const major = await windowsPowerShellVersionPromise
  if (major === null || major >= 5) return true

  // Web-Only（headless）下无宿主弹窗可用，原 dialog + app.quit 交互流程
  // 降级为日志（参照 safeShowErrorBox 的 web 降级做法），服务不退出。
  const isZh = Intl.DateTimeFormat().resolvedOptions().locale?.startsWith('zh')
  mainLogger.warn(
    isZh
      ? `检测到 PowerShell 版本为 ${major}.x，部分功能需要 PowerShell 5.1 才能正常运行，请安装 Windows Management Framework 5.1`
      : `Detected PowerShell version ${major}.x. Some features require PowerShell 5.1 (Windows Management Framework 5.1).`
  )
  return true
}

configureAppPaths()

const mainLogger = createLogger('Main')

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

setupPlatformSpecifics()
setupAppLifecycle()

const initPromise = (async () => {
  await initBasic()

  const adminPromise: Promise<boolean> =
    process.platform === 'win32' ? checkAdminPrivileges().catch(() => false) : Promise.resolve(true)

  const appConfigPromise = (async () => {
    try {
      const cfg = await getAppConfig()
      if (!cfg.language) {
        const systemLanguage = getSystemLanguage()
        await patchAppConfig({ language: systemLanguage })
        cfg.language = systemLanguage
      }
      await initI18n({ lng: cfg.language })
      return cfg
    } catch (e) {
      safeShowErrorBox('common.error.initFailed', `${e}`)
      app.quit()
      throw e
    }
  })()

  return { appConfig: await appConfigPromise, adminPromise }
})()

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('party.mihomo.app')

    const { adminPromise } = await initPromise
    beginCoreInitialization()

    // 安全检查尽早并行执行，但只用一个布尔 gate 控制核心启动。
    const startupSafetyPromise = (async (): Promise<boolean> => {
      const isAdmin = await adminPromise
      await initAdminStatus()
      if (!(await ensureSupportedWindowsPowerShell())) return false

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

    registerIpcMainHandlers()

    const bridge = await startWebBridge({
      platform: process.platform,
      version: app.getVersion(),
      staticRoot: join(__dirname, '../renderer'),
      // electron-vite dev 注入的是 ELECTRON_RENDERER_URL；容器/生产下为空，
      // web 桥接走静态产物。
      devServerUrl: process.env['ELECTRON_RENDERER_URL'],
      rpc: createRpcRouter(asyncHandlers, syncHandlers, WEB_BLOCKED_CHANNELS),
      onSend: (channel, args) => ipcMain.emit(channel, ...args)
    })
    // 主进程事件推送出口接到 WS 桥（替代原 setMainWindowStub(bridge.broadcast)）
    setBroadcaster(bridge.broadcast)
    const host = process.env.CP_WEB_HOST || '127.0.0.1'
    // 账号密码登录（初始账号 admin，凭据哈希存 dataDir/web-auth.json，首次启动自动生成）
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
              initProfileUpdater().catch((e) =>
                mainLogger.warn('Failed to init profile updater', e)
              ),
              initWebdavBackupScheduler().catch((e) =>
                mainLogger.warn('Failed to init webdav backup scheduler', e)
              ),
              checkAdminRestartForTun().catch((e) =>
                mainLogger.warn('Failed admin-restart-for-tun follow-up', e)
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
  })
  .catch((error) => {
    mainLogger.error('Application startup failed', error)
    safeShowErrorBox('common.error.initFailed', `${error}`)
    app.quit()
  })
