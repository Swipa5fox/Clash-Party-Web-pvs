function checkIpcError<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'invokeError' in response) {
    throw (response as { invokeError: unknown }).invokeError
  }
  return response as T
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(channel, ...args)
  return checkIpcError<T>(response)
}

// IPC API 类型定义
interface IpcApi {
  // Mihomo API
  mihomoVersion: () => Promise<IMihomoVersion>
  mihomoCloseConnection: (id: string) => Promise<void>
  mihomoCloseAllConnections: () => Promise<void>
  mihomoRules: () => Promise<IMihomoRulesInfo>
  mihomoRulesDisable: (rules: Record<string, boolean>) => Promise<void>
  mihomoProxies: () => Promise<IMihomoProxies>
  mihomoGroups: (includeHidden?: boolean) => Promise<IMihomoMixedGroup[]>
  mihomoProxyProviders: () => Promise<IMihomoProxyProviders>
  mihomoUpdateProxyProviders: (name: string) => Promise<void>
  mihomoRuleProviders: () => Promise<IMihomoRuleProviders>
  mihomoUpdateRuleProviders: (name: string) => Promise<void>
  mihomoChangeProxy: (group: string, proxy: string) => Promise<IMihomoProxy>
  mihomoUnfixedProxy: (group: string) => Promise<IMihomoProxy>
  mihomoUpgradeGeo: () => Promise<void>
  mihomoUpgrade: () => Promise<void>
  mihomoProxyDelay: (proxy: string, url?: string, provider?: string) => Promise<IMihomoDelay>
  mihomoGroupDelay: (group: string, url?: string) => Promise<IMihomoGroupDelay>
  patchMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  mihomoSmartGroupWeights: (groupName: string) => Promise<Record<string, number>>
  mihomoSmartFlushCache: (configName?: string) => Promise<void>
  getSmartOverrideContent: () => Promise<string | null>
  // Config
  getAppConfig: (force?: boolean) => Promise<IAppConfig>
  patchAppConfig: (patch: Partial<IAppConfig>) => Promise<void>
  getControledMihomoConfig: (force?: boolean) => Promise<Partial<IMihomoConfig>>
  patchControledMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  // Profile
  getProfileConfig: (force?: boolean) => Promise<IProfileConfig>
  setProfileConfig: (config: IProfileConfig) => Promise<void>
  getCurrentProfileItem: () => Promise<IProfileItem>
  getProfileItem: (id: string | undefined) => Promise<IProfileItem>
  getProfileStr: (id: string) => Promise<string>
  setProfileStr: (id: string, str: string) => Promise<void>
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  updateProfileItem: (item: IProfileItem) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
  addProfileUpdater: (item: IProfileItem) => Promise<void>
  removeProfileUpdater: (id: string) => Promise<void>
  // Override
  getOverrideConfig: (force?: boolean) => Promise<IOverrideConfig>
  setOverrideConfig: (config: IOverrideConfig) => Promise<void>
  getOverrideItem: (id: string) => Promise<IOverrideItem | undefined>
  addOverrideItem: (item: Partial<IOverrideItem>) => Promise<void>
  removeOverrideItem: (id: string) => Promise<void>
  updateOverrideItem: (item: IOverrideItem) => Promise<void>
  getOverride: (id: string, ext: 'js' | 'yaml' | 'log') => Promise<string>
  setOverride: (id: string, ext: 'js' | 'yaml', str: string) => Promise<void>
  // Custom Line Groups
  getCustomLineGroupsConfig: (force?: boolean) => Promise<ICustomLineGroupsConfig>
  setCustomLineGroupsConfig: (config: ICustomLineGroupsConfig) => Promise<void>
  checkPortOccupied: (port: number, extraHosts?: string[]) => Promise<IPortCheckResult>
  // File
  getFileStr: (path: string) => Promise<string>
  setFileStr: (path: string, str: string) => Promise<void>
  convertMrsRuleset: (path: string, behavior: string) => Promise<string>
  getRuntimeConfig: () => Promise<IMihomoConfig>
  getRuntimeConfigStr: () => Promise<string>
  getRuleStr: (id: string) => Promise<string>
  setRuleStr: (id: string, str: string) => Promise<void>
  // Core
  restartCore: () => Promise<void>
  mihomoHotReloadConfig: () => Promise<void>
  // System
  triggerSysProxy: (enable: boolean) => Promise<void>
  checkTunPermissions: () => Promise<boolean>
  checkAdminPrivileges: () => Promise<boolean>
  checkMihomoCorePermissions: () => Promise<boolean>
  checkHighPrivilegeCore: () => Promise<boolean>
  setupFirewall: () => Promise<void>
  getInterfaces: () => Promise<Record<string, NetworkInterfaceInfo[]>>
  setNativeTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  copyEnvText: (type?: 'bash' | 'cmd' | 'powershell' | 'fish' | 'nushell') => Promise<string>
  // Update
  getVersion: () => Promise<string>
  platform: () => Promise<NodeJS.Platform>
  getDeploymentEnv: () => Promise<'desktop' | 'container'>
  fetchMihomoTags: (
    forceRefresh?: boolean
  ) => Promise<{ name: string; zipball_url: string; tarball_url: string }[]>
  installSpecificMihomoCore: (version: string) => Promise<void>
  clearMihomoVersionCache: () => Promise<void>
  // Backup
  webdavBackup: () => Promise<boolean>
  webdavRestore: (filename: string) => Promise<void>
  listWebdavBackups: () => Promise<string[]>
  webdavDelete: (filename: string) => Promise<void>
  reinitWebdavBackupScheduler: () => Promise<void>
  exportLocalBackup: () => Promise<boolean>
  importLocalBackup: () => Promise<boolean>
  exportLocalBackupBase64: () => Promise<string>
  importLocalBackupFromContent: (content: string) => Promise<void>
  // Theme
  resolveThemes: () => Promise<{ key: string; label: string; content: string }[]>
  fetchThemes: () => Promise<void>
  importThemesFromContents: (files: { name: string; content: string }[]) => Promise<number>
  readTheme: (theme: string) => Promise<string>
  writeTheme: (theme: string, css: string) => Promise<void>
  // Plugin
  getPluginConfig: (force?: boolean) => Promise<IPluginConfig>
  previewPlugin: (fileBytesB64: string) => Promise<IPluginDescriptorPreview>
  installPlugin: (fileBytesB64: string) => Promise<IPluginItem>
  loginPlugin: (id: string) => Promise<void>
  removePlugin: (id: string) => Promise<void>
  updatePluginProfile: (id: string, force?: boolean) => Promise<void>
  patchPluginItem: (id: string, patch: Partial<IPluginItem>) => Promise<void>
  // Misc
  getGistUrl: () => Promise<string>
  generateGistAgeKeyPair: () => Promise<{ secretKey: string; recipient: string }>
  exportGistAgeSecretKeyText: () => Promise<string>
  fetchIPInfo: (url: string) => Promise<unknown>
  measureLatency: (url: string) => Promise<number | null>
  getImageDataURL: (url: string) => Promise<string>
  // File Share
  getFileShareServerState: () => Promise<IFileShareServerState>
  restartFileShareServer: () => Promise<void>
  listFileShareFiles: () => Promise<IFileShareFileInfo[]>
  addFileShareFile: (fileName: string, contentBase64: string) => Promise<IFileShareAddResult>
  revokeFileShareFile: (file: string) => Promise<void>
  getFileShareUrls: (file: string) => Promise<string[]>
  setFileShareFileMeta: (file: string, patch: IFileShareFileMetaPatch) => Promise<void>
  renameFileShareGroup: (from: string, to: string) => Promise<void>
}

// 使用 Proxy 自动生成 IPC 调用
const ipc = new Proxy({} as IpcApi, {
  get:
    <K extends keyof IpcApi>(_: IpcApi, channel: K) =>
    (...args: Parameters<IpcApi[K]>) =>
      invoke(channel, ...args)
})

// 导出所有 IPC 方法
export const {
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
  mihomoProxyDelay,
  mihomoGroupDelay,
  patchMihomoConfig,
  mihomoSmartGroupWeights,
  mihomoSmartFlushCache,
  getSmartOverrideContent,
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
  setCustomLineGroupsConfig,
  checkPortOccupied,
  // File
  getFileStr,
  setFileStr,
  convertMrsRuleset,
  getRuntimeConfig,
  getRuntimeConfigStr,
  getRuleStr,
  setRuleStr,
  // Core
  restartCore,
  mihomoHotReloadConfig,
  // System
  triggerSysProxy,
  checkTunPermissions,
  checkAdminPrivileges,
  checkMihomoCorePermissions,
  checkHighPrivilegeCore,
  setupFirewall,
  getInterfaces,
  setNativeTheme,
  copyEnvText,
  // Update
  getVersion,
  fetchMihomoTags,
  installSpecificMihomoCore,
  clearMihomoVersionCache,
  // Backup
  webdavBackup,
  webdavRestore,
  listWebdavBackups,
  webdavDelete,
  reinitWebdavBackupScheduler,
  exportLocalBackup,
  importLocalBackup,
  exportLocalBackupBase64,
  importLocalBackupFromContent,
  // Theme
  resolveThemes,
  fetchThemes,
  importThemesFromContents,
  readTheme,
  writeTheme,
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
  exportGistAgeSecretKeyText,
  fetchIPInfo,
  measureLatency,
  getImageDataURL,
  // File Share
  getFileShareServerState,
  restartFileShareServer,
  listFileShareFiles,
  addFileShareFile,
  revokeFileShareFile,
  getFileShareUrls,
  setFileShareFileMeta,
  renameFileShareGroup,
  getDeploymentEnv
} = ipc

// platform 需要重命名导出
export const getPlatform = ipc.platform

// 需要特殊处理的函数

// applyTheme: 主题 CSS 由渲染层本地注入（桌面壳移除后主进程无 BrowserWindow
// 可 insertCSS），经 readTheme 通道读取主题文件后写入 <style>；防抖处理避免频繁调用
const CUSTOM_THEME_STYLE_ID = 'custom-theme-style'
let applyThemeRunning = false
let pendingTheme: string | null = null

async function injectThemeCss(theme: string): Promise<void> {
  let css = ''
  if (theme && theme !== 'default.css') {
    css = await readTheme(theme)
  }
  let style = document.getElementById(CUSTOM_THEME_STYLE_ID)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = CUSTOM_THEME_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
}

export async function applyTheme(theme: string): Promise<void> {
  if (applyThemeRunning) {
    pendingTheme = theme
    return
  }
  applyThemeRunning = true
  try {
    await injectThemeCss(theme)
  } catch {
    // 主题文件缺失/读取失败时回退为无自定义样式
    document.getElementById(CUSTOM_THEME_STYLE_ID)?.remove()
  } finally {
    applyThemeRunning = false
    if (pendingTheme !== null) {
      const nextTheme = pendingTheme
      pendingTheme = null
      await applyTheme(nextTheme)
    }
  }
}

// getAppName: 获取应用程序名称
export async function getAppName(appPath: string): Promise<string> {
  return invoke<string>('getAppName', appPath)
}

// getIconDataURL: 获取应用图标的 Base64 数据
export async function getIconDataURL(appPath: string): Promise<string> {
  return invoke<string>('getIconDataURL', appPath)
}
