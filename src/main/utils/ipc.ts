import path from 'path'
import v8 from 'v8'
import { readFile } from 'fs/promises'
import { app, ipcMain } from 'electron'
import i18next from 'i18next'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoCloseConnection,
  mihomoGroupDelay,
  mihomoGroups,
  mihomoProxies,
  mihomoProxyDelay,
  mihomoProxyProviders,
  mihomoRuleProviders,
  mihomoRules,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders,
  mihomoUpdateRuleProviders,
  mihomoUpgrade,
  mihomoUpgradeGeo,
  mihomoUpgradeUI,
  mihomoHotReloadConfig,
  mihomoVersion,
  patchMihomoConfig,
  mihomoSmartGroupWeights,
  mihomoSmartFlushCache,
  mihomoRulesDisable
} from '../core/mihomoApi'
import { checkAutoRun, disableAutoRun, enableAutoRun } from '../sys/autoRun'
import {
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  getProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  addProfileItem,
  removeProfileItem,
  changeCurrentProfile,
  getProfileStr,
  getFileStr,
  setFileStr,
  setProfileStr,
  updateProfileItem,
  setProfileConfig,
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  getOverride,
  setOverride,
  updateOverrideItem,
  convertMrsRuleset
} from '../config'
import { getCustomLineGroupsConfig, setCustomLineGroupsConfig } from '../config/customLineGroups'
import {
  quitWithoutCore,
  restartCore,
  checkTunPermissions,
  grantTunPermissions,
  manualGrantCorePermition,
  checkAdminPrivileges,
  restartAsAdmin,
  checkMihomoCorePermissions,
  requestTunPermissions,
  checkHighPrivilegeCore,
  showTunPermissionDialog,
  showErrorDialog
} from '../core/manager'
import { triggerSysProxy } from '../sys/sysproxy'
import { checkUpdate, downloadAndInstallUpdate } from '../resolve/autoUpdater'
import {
  getFilePath,
  openFile,
  openUWPTool,
  readImageFileDataURL,
  readTextFile,
  resetAppConfig,
  setNativeTheme,
  setupFirewall
} from '../sys/misc'
import { getRuntimeConfig, getRuntimeConfigStr } from '../core/factory'
import {
  listWebdavBackups,
  webdavBackup,
  webdavDelete,
  webdavRestore,
  exportLocalBackup,
  importLocalBackup,
  exportBackupToBase64,
  importBackupFromBase64,
  reinitScheduler
} from '../resolve/backup'
import { getInterfaces } from '../sys/interface'
import {
  closeTrayIcon,
  copyEnv,
  showTrayIcon,
  updateTrayIcon,
  updateTrayIconImmediate,
  buildEnvText,
  type EnvType
} from '../resolve/tray'
import { registerShortcut } from '../resolve/shortcut'
import { closeMainWindow, mainWindow, showMainWindow, triggerMainWindow } from '../window'
import {
  applyTheme,
  fetchThemes,
  importThemes,
  importThemesFromContents,
  readTheme,
  resolveThemes,
  writeTheme
} from '../resolve/theme'
import {
  exportGistAgeSecretKey,
  exportGistAgeSecretKeyText,
  generateGistAgeKeyPair,
  getGistUrl
} from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { closeFloatingWindow, showContextMenu, showFloatingWindow } from '../resolve/floatingWindow'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import {
  previewPlugin,
  installPlugin,
  loginPlugin,
  removePlugin,
  updatePluginProfile,
  patchPluginItem
} from '../resolve/plugin'
import { getPluginConfig } from '../config/plugin'
import { getImageDataURL } from './image'
import { get as httpGet } from './chromeRequest'
import { getIconDataURL } from './icon'
import { getAppName } from './appName'
import { getDeploymentEnv } from './deployment'
import { dataDir, logDir, rulePath } from './dirs'
import { installMihomoCore, getGitHubTags, clearVersionCache } from './github'
import { atomicWriteFile } from './safeFile'
import { checkPortOccupied } from './portCheck'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AsyncFn = (...args: any[]) => Promise<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncFn = (...args: any[]) => any

function wrapAsync<T extends AsyncFn>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | { invokeError: unknown }> {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e && typeof e === 'object' && 'message' in e) {
        return { invokeError: e.message }
      }
      return { invokeError: typeof e === 'string' ? e : 'Unknown Error' }
    }
  }
}

function registerHandlers(handlers: Record<string, AsyncFn | SyncFn>, async = true): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    if (async) {
      ipcMain.handle(channel, (_e, ...args) => wrapAsync(handler as AsyncFn)(...args))
    } else {
      ipcMain.handle(channel, (_e, ...args) => (handler as SyncFn)(...args))
    }
  }
}

async function fetchMihomoTags(
  forceRefresh = false
): Promise<{ name: string; zipball_url: string; tarball_url: string }[]> {
  return await getGitHubTags('MetaCubeX', 'mihomo', forceRefresh)
}

async function installSpecificMihomoCore(version: string): Promise<void> {
  clearVersionCache('MetaCubeX', 'mihomo')
  return await installMihomoCore(version)
}

async function clearMihomoVersionCache(): Promise<void> {
  clearVersionCache('MetaCubeX', 'mihomo')
}

async function getRuleStr(id: string): Promise<string> {
  return await readFile(rulePath(id), 'utf-8')
}

// 保存自定义线路组后重新生成配置并热重载内核,使新代理组/端口立即生效
async function saveCustomLineGroups(config: ICustomLineGroupsConfig): Promise<void> {
  await setCustomLineGroupsConfig(config)
  try {
    await mihomoHotReloadConfig()
    mainWindow?.webContents.send('groupsUpdated')
  } catch {
    // 热重载失败时保留配置,下次内核重启生效
  }
}

async function setRuleStr(id: string, str: string): Promise<void> {
  await atomicWriteFile(rulePath(id), str, { encoding: 'utf8' })
}

async function getSmartOverrideContent(): Promise<string | null> {
  try {
    const override = await getOverrideItem('smart-core-override')
    return override?.file || null
  } catch {
    return null
  }
}

async function fetchIPInfo(url: string): Promise<unknown> {
  const res = await httpGet<unknown>(url, { timeout: 10000, responseType: 'json' })
  return res.data
}

async function measureLatency(url: string): Promise<number | null> {
  try {
    const t0 = Date.now()
    await httpGet<unknown>(url, { timeout: 5000, responseType: 'text' })
    return Date.now() - t0
  } catch {
    return null
  }
}

async function changeLanguage(lng: string): Promise<void> {
  await i18next.changeLanguage(lng)
  ipcMain.emit('updateTrayMenu')
}

async function setTitleBarOverlay(overlay: Electron.TitleBarOverlayOptions): Promise<void> {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === 'function') {
    mainWindow.setTitleBarOverlay(overlay)
  }
}

// Web 模式判定（与 index.ts 保持一致）
const webMode = process.argv.includes('--web') || !!process.env.CP_WEB_MODE

// Web 模式下限制 getFileStr/setFileStr 的访问范围在 dataDir 内，防止远程任意路径读写
function assertPathInsideDataDir(filePath: string): void {
  const resolved = path.resolve(dataDir(), filePath)
  const rel = path.relative(dataDir(), resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path outside data directory')
  }
}

async function getFileStrChecked(filePath: string): Promise<string> {
  if (webMode) assertPathInsideDataDir(filePath)
  return await getFileStr(filePath)
}

async function setFileStrChecked(filePath: string, content: string): Promise<void> {
  if (webMode) assertPathInsideDataDir(filePath)
  return await setFileStr(filePath, content)
}

export const asyncHandlers: Record<string, AsyncFn> = {
  // Mihomo API
  mihomoVersion,
  mihomoCloseConnection,
  mihomoCloseAllConnections,
  mihomoRules,
  mihomoRulesDisable,
  mihomoProxies,
  mihomoGroups,
  mihomoProxyProviders,
  mihomoUpdateProxyProviders,
  mihomoRuleProviders,
  mihomoUpdateRuleProviders,
  mihomoChangeProxy,
  mihomoUnfixedProxy,
  mihomoUpgradeGeo,
  mihomoUpgrade,
  mihomoUpgradeUI,
  mihomoProxyDelay,
  mihomoGroupDelay,
  patchMihomoConfig,
  mihomoSmartGroupWeights,
  mihomoSmartFlushCache,
  // AutoRun
  checkAutoRun,
  enableAutoRun,
  disableAutoRun,
  // Config
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  // Profile
  getProfileConfig,
  setProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  getProfileStr,
  setProfileStr,
  addProfileItem,
  removeProfileItem,
  updateProfileItem,
  changeCurrentProfile,
  addProfileUpdater,
  removeProfileUpdater,
  // Override
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  updateOverrideItem,
  getOverride,
  setOverride,
  // Custom Line Groups
  getCustomLineGroupsConfig,
  setCustomLineGroupsConfig: saveCustomLineGroups,
  checkPortOccupied,
  // File
  getFileStr: getFileStrChecked,
  setFileStr: setFileStrChecked,
  convertMrsRuleset,
  getRuntimeConfig,
  getRuntimeConfigStr,
  getSmartOverrideContent,
  getRuleStr,
  setRuleStr,
  readTextFile,
  // Core
  restartCore,
  mihomoHotReloadConfig,
  startMonitor,
  quitWithoutCore,
  // System
  triggerSysProxy,
  checkTunPermissions,
  grantTunPermissions,
  manualGrantCorePermition,
  checkAdminPrivileges,
  restartAsAdmin,
  checkMihomoCorePermissions,
  requestTunPermissions,
  checkHighPrivilegeCore,
  showTunPermissionDialog,
  showErrorDialog,
  openUWPTool,
  setupFirewall,
  copyEnv,
  copyEnvText: async (type?: EnvType) => await buildEnvText(type),
  // Update
  checkUpdate,
  downloadAndInstallUpdate,
  fetchMihomoTags,
  installSpecificMihomoCore,
  clearMihomoVersionCache,
  // Backup
  webdavBackup,
  webdavRestore,
  listWebdavBackups,
  webdavDelete,
  reinitWebdavBackupScheduler: reinitScheduler,
  exportLocalBackup,
  importLocalBackup,
  exportLocalBackupBase64: exportBackupToBase64,
  importLocalBackupFromContent: importBackupFromBase64,
  // Theme
  resolveThemes,
  fetchThemes,
  importThemes,
  importThemesFromContents,
  readTheme,
  writeTheme,
  applyTheme,
  // Tray
  showTrayIcon,
  closeTrayIcon,
  updateTrayIcon,
  // Floating Window
  showFloatingWindow,
  closeFloatingWindow,
  showContextMenu,
  // Plugin
  getPluginConfig,
  previewPlugin,
  installPlugin,
  loginPlugin,
  removePlugin,
  updatePluginProfile,
  patchPluginItem,
  // Misc
  getGistUrl,
  generateGistAgeKeyPair,
  exportGistAgeSecretKey,
  exportGistAgeSecretKeyText,
  fetchIPInfo,
  measureLatency,
  getImageDataURL,
  readImageFileDataURL,
  getIconDataURL,
  getAppName,
  changeLanguage,
  setTitleBarOverlay,
  registerShortcut
}

export const syncHandlers: Record<string, SyncFn> = {
  resetAppConfig,
  getFilePath,
  openFile,
  getInterfaces,
  setNativeTheme,
  getVersion: () => app.getVersion(),
  platform: () => process.platform,
  getDeploymentEnv,
  updateTrayIconImmediate,
  showMainWindow,
  closeMainWindow,
  triggerMainWindow,
  setAlwaysOnTop: (alwaysOnTop: boolean) => mainWindow?.setAlwaysOnTop(alwaysOnTop),
  isAlwaysOnTop: () => mainWindow?.isAlwaysOnTop(),
  openDevTools: () => mainWindow?.webContents.openDevTools(),
  createHeapSnapshot: () => v8.writeHeapSnapshot(path.join(logDir(), `${Date.now()}.heapsnapshot`)),
  relaunchApp: () => {
    app.relaunch()
    app.quit()
  },
  quitApp: () => app.quit()
}

export function registerIpcMainHandlers(): void {
  registerHandlers(asyncHandlers, true)
  registerHandlers(syncHandlers, false)
}
