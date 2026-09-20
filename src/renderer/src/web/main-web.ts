// Web 模式入口：浏览器端 preload shim
// 通过 WebSocket 桥接主进程 IPC，暴露面与 src/preload/index.ts 逐一对齐
import type { IpcRendererEvent } from 'electron'

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void

// 允许的 invoke channels 白名单（与 preload 保持一致）
const validInvokeChannels: readonly string[] = [
  // Mihomo API
  'mihomoVersion',
  'mihomoCloseConnection',
  'mihomoCloseAllConnections',
  'mihomoRules',
  'mihomoRulesDisable',
  'mihomoProxies',
  'mihomoGroups',
  'mihomoProxyProviders',
  'mihomoUpdateProxyProviders',
  'mihomoRuleProviders',
  'mihomoUpdateRuleProviders',
  'mihomoChangeProxy',
  'mihomoUnfixedProxy',
  'mihomoUpgradeGeo',
  'mihomoUpgrade',
  'mihomoUpgradeUI',
  'mihomoProxyDelay',
  'mihomoGroupDelay',
  'patchMihomoConfig',
  'mihomoSmartGroupWeights',
  'mihomoSmartFlushCache',
  // AutoRun
  'checkAutoRun',
  'enableAutoRun',
  'disableAutoRun',
  // Config
  'getAppConfig',
  'patchAppConfig',
  'getControledMihomoConfig',
  'patchControledMihomoConfig',
  'resetAppConfig',
  // Profile
  'getProfileConfig',
  'setProfileConfig',
  'getCurrentProfileItem',
  'getProfileItem',
  'getProfileStr',
  'setProfileStr',
  'addProfileItem',
  'removeProfileItem',
  'updateProfileItem',
  'changeCurrentProfile',
  'addProfileUpdater',
  'removeProfileUpdater',
  // Override
  'getOverrideConfig',
  'setOverrideConfig',
  'getOverrideItem',
  'addOverrideItem',
  'removeOverrideItem',
  'updateOverrideItem',
  'getOverride',
  'setOverride',
  // File
  'getFileStr',
  'setFileStr',
  'convertMrsRuleset',
  'getRuntimeConfig',
  'getRuntimeConfigStr',
  'getSmartOverrideContent',
  'getRuleStr',
  'setRuleStr',
  'getFilePath',
  'readTextFile',
  'readImageFileDataURL',
  'openFile',
  // Core
  'restartCore',
  'mihomoHotReloadConfig',
  'startMonitor',
  'quitWithoutCore',
  // System
  'triggerSysProxy',
  'checkTunPermissions',
  'grantTunPermissions',
  'manualGrantCorePermition',
  'checkAdminPrivileges',
  'restartAsAdmin',
  'checkMihomoCorePermissions',
  'requestTunPermissions',
  'checkHighPrivilegeCore',
  'showTunPermissionDialog',
  'showErrorDialog',
  'openUWPTool',
  'setupFirewall',
  'getInterfaces',
  'setNativeTheme',
  'copyEnv',
  'copyEnvText',
  // Update
  'checkUpdate',
  'downloadAndInstallUpdate',
  'getVersion',
  'platform',
  'getDeploymentEnv',
  'fetchMihomoTags',
  'installSpecificMihomoCore',
  'clearMihomoVersionCache',
  // Backup
  'webdavBackup',
  'webdavRestore',
  'listWebdavBackups',
  'webdavDelete',
  'reinitWebdavBackupScheduler',
  'exportLocalBackup',
  'importLocalBackup',
  'exportLocalBackupBase64',
  'importLocalBackupFromContent',
  // Theme
  'resolveThemes',
  'fetchThemes',
  'importThemes',
  'importThemesFromContents',
  'readTheme',
  'writeTheme',
  'applyTheme',
  // Tray
  'showTrayIcon',
  'closeTrayIcon',
  'updateTrayIcon',
  'updateTrayIconImmediate',
  // Window
  'showMainWindow',
  'closeMainWindow',
  'triggerMainWindow',
  'showFloatingWindow',
  'closeFloatingWindow',
  'showContextMenu',
  'setTitleBarOverlay',
  'setAlwaysOnTop',
  'isAlwaysOnTop',
  'openDevTools',
  'createHeapSnapshot',
  'relaunchApp',
  'quitApp',
  // Shortcut
  'registerShortcut',
  // Plugin
  'getPluginConfig',
  'previewPlugin',
  'installPlugin',
  'loginPlugin',
  'removePlugin',
  'updatePluginProfile',
  'patchPluginItem',
  // Misc
  'getGistUrl',
  'generateGistAgeKeyPair',
  'exportGistAgeSecretKey',
  'exportGistAgeSecretKeyText',
  'fetchIPInfo',
  'measureLatency',
  'getImageDataURL',
  'getIconDataURL',
  'getAppName',
  'changeLanguage'
]

// 允许的 on/removeListener channels 白名单（与 preload 保持一致）
const validListenChannels: readonly string[] = [
  'mihomoLogs',
  'mihomoConnections',
  'mihomoTraffic',
  'mihomoMemory',
  'appConfigUpdated',
  'controledMihomoConfigUpdated',
  'profileConfigUpdated',
  'groupsUpdated',
  'rulesUpdated',
  'updateDownloadProgress',
  'pluginConfigUpdated',
  'openPluginFile'
]

// 允许的 send channels 白名单（与 preload 保持一致）
const validSendChannels: readonly string[] = [
  'updateTrayMenu',
  'updateFloatingWindow',
  'trayIconUpdate',
  'rendererFirstContentReady'
]

// ---- WebSocket 桥 ----
const TOKEN_STORAGE_KEY = 'cp:web:token'
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 10000
const TOKEN_CLOSE_CODE = 4001

type HelloMessage = { type: 'hello'; ok: boolean; platform?: NodeJS.Platform; version?: string }
type ResultMessage =
  | { type: 'result'; id: number; ok: true; data?: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
type EventMessage = { type: 'event'; channel: string; payload?: unknown }
type ServerMessage = HelloMessage | ResultMessage | EventMessage

interface PendingInvoke {
  id: number
  channel: string
  args: unknown[]
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const listenerMap = new Map<string, Set<IpcListener>>()
const pendingInvokes = new Map<number, PendingInvoke>()

// 平台信息：hello 后由桥填充，形状与 preload 的 window.electron.process 一致
const processInfo = { platform: undefined as unknown as NodeJS.Platform }

let ws: WebSocket | null = null
let ready = false
let appStarted = false
let fatal = false
let nextInvokeId = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_BASE_DELAY

// ---- token：URL ?token= 优先并写入 sessionStorage，随后从地址栏清除 ----
let token = new URLSearchParams(location.search).get('token')
if (token) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
  history.replaceState(null, '', location.pathname + location.hash)
} else {
  token = sessionStorage.getItem(TOKEN_STORAGE_KEY)
}

// 响应 reviver：还原桥侧序列化的特殊值
// {__buf: base64} -> Uint8Array；{__img: dataURL} -> dataURL 字符串
function revive(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    if ('__buf' in value) {
      const binary = atob((value as { __buf: string }).__buf)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    }
    if ('__img' in value) {
      return (value as { __img: string }).__img
    }
  }
  return value
}

function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws?token=${encodeURIComponent(token ?? '')}`
}

function sendRaw(message: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

// 冲刷队列：断开后新进来的 invoke 停留在 pendingInvokes 中，hello ok 后统一发出
function flushPendingInvokes(): void {
  pendingInvokes.forEach((entry) => {
    sendRaw({ type: 'invoke', id: entry.id, channel: entry.channel, args: entry.args })
  })
}

function rejectPendingInvokes(reason: string): void {
  pendingInvokes.forEach((entry) => {
    entry.reject(reason)
  })
  pendingInvokes.clear()
}

function dispatchEvent(channel: string, payload?: unknown): void {
  const listeners = listenerMap.get(channel)
  if (!listeners || listeners.size === 0) {
    return
  }
  // 合成事件仅作占位，保证 listener 收到 (event, payload) 与 preload 签名一致
  const event = {} as IpcRendererEvent
  listeners.forEach((listener) => {
    try {
      listener(event, payload)
    } catch (error) {
      console.error(error)
    }
  })
}

function showFatalError(message: string): void {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  root.textContent = ''
  const tip = document.createElement('div')
  tip.style.cssText =
    'display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;text-align:center;font-size:16px;color:#e5484d'
  tip.textContent = message
  root.appendChild(tip)
}

function startApp(): void {
  if (appStarted) {
    return
  }
  appStarted = true
  // 动态加载应用：确保 platform 先于应用代码就绪
  import('../main').catch((error) => {
    console.error('failed to load app:', error)
  })
}

function enterFatalState(message: string): void {
  fatal = true
  ready = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  rejectPendingInvokes('web bridge disconnected')
  showFatalError(message)
  ws?.close()
}

function handleServerMessage(raw: string): void {
  let message: ServerMessage
  try {
    message = JSON.parse(raw, revive) as ServerMessage
  } catch (error) {
    console.error('invalid bridge message:', error)
    return
  }
  if (message.type === 'hello') {
    if (message.ok) {
      ready = true
      reconnectDelay = RECONNECT_BASE_DELAY
      if (message.platform) {
        processInfo.platform = message.platform
      }
      // window.process 仅在 preload 环境存在，此处用受控断言赋值（镜像 preload 形状）
      browserWindow.process = processInfo
      flushPendingInvokes()
      startApp()
    } else {
      enterFatalState('Web 桥连接失败：Token 无效或已过期，请从应用控制台输出的链接重新访问')
    }
    return
  }
  if (message.type === 'result') {
    const entry = pendingInvokes.get(message.id)
    if (entry) {
      pendingInvokes.delete(message.id)
      if (message.ok) {
        entry.resolve(message.data)
      } else {
        // 与 renderer checkIpcError 语义一致：调用方 await 时抛出错误字符串本身
        entry.reject(message.error)
      }
    }
    return
  }
  if (message.type === 'event') {
    dispatchEvent(message.channel, message.payload)
  }
}

function scheduleReconnect(): void {
  if (fatal || reconnectTimer) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY)
}

function connect(): void {
  if (fatal) {
    return
  }
  let socket: WebSocket
  try {
    socket = new WebSocket(wsUrl())
  } catch (error) {
    console.error('failed to create websocket:', error)
    scheduleReconnect()
    return
  }
  ws = socket
  socket.onopen = () => {
    // token 已随 URL 携带，连接后立刻补发 hello 完成握手
    sendRaw({ type: 'hello', token })
  }
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      handleServerMessage(event.data)
    }
  }
  socket.onclose = (event: CloseEvent) => {
    if (ws === socket) {
      ws = null
      ready = false
    }
    if (fatal) {
      return
    }
    if (event.code === TOKEN_CLOSE_CODE) {
      enterFatalState(
        'Web 桥连接失败：Token 无效或已过期（close 4001），请从应用控制台输出的链接重新访问'
      )
      return
    }
    // 断开期间所有未完成的 invoke 立即失败
    rejectPendingInvokes('web bridge disconnected')
    scheduleReconnect()
  }
}

// ---- window.electron / window.api（形状与 preload 暴露面一致）----
const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      if (!validInvokeChannels.includes(channel)) {
        return Promise.reject(new Error(`Invalid invoke channel: ${channel}`))
      }
      return new Promise<unknown>((resolve, reject) => {
        nextInvokeId += 1
        const entry: PendingInvoke = { id: nextInvokeId, channel, args, resolve, reject }
        pendingInvokes.set(entry.id, entry)
        // hello 前进队列，hello ok 后冲刷
        if (ready) {
          sendRaw({ type: 'invoke', id: entry.id, channel, args })
        }
      })
    },
    send: (channel: string, ...args: unknown[]): void => {
      if (validSendChannels.includes(channel)) {
        sendRaw({ type: 'send', channel, args })
      }
    },
    on: (channel: string, listener: IpcListener): void => {
      if (validListenChannels.includes(channel)) {
        if (!listenerMap.has(channel)) {
          listenerMap.set(channel, new Set())
        }
        listenerMap.get(channel)?.add(listener)
      }
    },
    removeListener: (channel: string, listener: IpcListener): void => {
      if (validListenChannels.includes(channel)) {
        listenerMap.get(channel)?.delete(listener)
      }
    },
    removeAllListeners: (channel: string): void => {
      if (validListenChannels.includes(channel)) {
        listenerMap.get(channel)?.clear()
      }
    }
  },
  // web 端标记：渲染层据此隐藏无意义的窗口控制（如置顶按钮）
  isWeb: true as const,
  process: processInfo
}

const api = {
  webUtils: {
    // 浏览器拿不到绝对路径，降级返回文件名（与 electron webUtils 同签名）
    getPathForFile: (file: File) => file.name
  }
}

// window.process 不在 DOM 类型中，且与 @types/node 的全局 process 交集，需受控断言访问
const browserWindow = window as unknown as { process: { platform: NodeJS.Platform } }

window.electron = electronAPI
window.api = api

connect()
