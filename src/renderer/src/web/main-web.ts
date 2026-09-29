// Web 模式入口：浏览器端 IPC shim
// 通过 WebSocket 桥接主进程 IPC，invoke 白名单与 src/main/utils/ipc.ts 的 handler 注册表逐一对齐
type IpcListener = (event: unknown, ...args: unknown[]) => void

// 允许的 invoke channels 白名单（与主进程 handler 注册表保持一致）
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
  'mihomoUpgradeGeo',
  'mihomoUpgrade',
  'mihomoProxyDelay',
  // Config
  'getAppConfig',
  'patchAppConfig',
  'getControledMihomoConfig',
  'patchControledMihomoConfig',
  // Profile
  'getProfileConfig',
  'setProfileConfig',
  'getProfileStr',
  'setProfileStr',
  'addProfileItem',
  'removeProfileItem',
  'updateProfileItem',
  'changeCurrentProfile',
  'addProfileUpdater',
  // Override
  'getOverrideConfig',
  'setOverrideConfig',
  'addOverrideItem',
  'removeOverrideItem',
  'updateOverrideItem',
  'getOverride',
  'setOverride',
  // Custom Line Groups
  'getCustomLineGroupsConfig',
  'setCustomLineGroupsConfig',
  'checkPortOccupied',
  // File
  'getFileStr',
  'setFileStr',
  'convertMrsRuleset',
  'getRuntimeConfig',
  'getRuntimeConfigStr',
  'getRuleStr',
  'setRuleStr',
  // Core
  'restartCore',
  'mihomoHotReloadConfig',
  // System
  'triggerSysProxy',
  'getInterfaces',
  'setNativeTheme',
  'copyEnvText',
  // Update
  'getVersion',
  'platform',
  'fetchMihomoTags',
  'installSpecificMihomoCore',
  'clearMihomoVersionCache',
  // Backup
  'webdavBackup',
  'webdavRestore',
  'listWebdavBackups',
  'webdavDelete',
  'reinitWebdavBackupScheduler',
  'exportLocalBackupBase64',
  'importLocalBackupFromContent',
  // Theme
  'resolveThemes',
  'fetchThemes',
  'importThemesFromContents',
  'readTheme',
  'writeTheme',
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
  'exportGistAgeSecretKeyText',
  'fetchIPInfo',
  'measureLatency',
  'getImageDataURL',
  'getIconDataURL',
  'changeLanguage',
  // File Share
  'getFileShareServerState',
  'restartFileShareServer',
  'listFileShareFiles',
  'addFileShareFile',
  'revokeFileShareFile',
  'getFileShareUrls',
  'setFileShareFileMeta',
  'renameFileShareGroup'
]

// 允许的 on/removeListener channels 白名单（与主进程 broadcastEvent 推送面保持一致）
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
  'pluginConfigUpdated'
]

// ---- WebSocket 桥 ----
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 10000

type HelloMessage = { type: 'hello'; ok: boolean }
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

let ws: WebSocket | null = null
let ready = false
let appStarted = false
let nextInvokeId = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_BASE_DELAY

// 鉴权由 Cookie 会话承担（登录页 POST /api/login 后 HttpOnly Cookie 自动随请求携带），
// 页面与 WS 均不再需要 URL token；会话失效时 HTTP 302 / WS 401 回登录页。

// 响应 reviver：还原桥侧序列化的特殊值
// {__buf: base64} -> Uint8Array
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
  }
  return value
}

function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Cookie 由浏览器随同源 WS 握手自动携带，无需显式传参
  return `${protocol}//${location.host}/ws`
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
  // 首参为占位 event，保持与 ipcRenderer.on 的 (event, payload) 签名一致
  listeners.forEach((listener) => {
    try {
      listener(undefined, payload)
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
    showFatalError('应用加载失败，请刷新页面重试')
  })
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
      flushPendingInvokes()
      startApp()
    } else {
      // 会话失效（如服务重启后 sid 不再有效）：整页刷新由 HTTP 302 引导回登录页
      location.reload()
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
  if (reconnectTimer) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY)
}

// 探测会话有效性：受保护路径在未登录时返回 302（fetch redirect:'manual' 表现为
// opaqueredirect / redirected），此时整页刷新由 HTTP 层引导回登录页
async function checkSessionAndMaybeReload(): Promise<void> {
  try {
    const res = await fetch('/', { redirect: 'manual' })
    if (res.type === 'opaqueredirect' || res.redirected) {
      location.reload()
    }
  } catch {
    // 网络错误：交给重连循环处理
  }
}

function connect(): void {
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
    // 无需发送 hello：会话已在 upgrade 阶段凭 Cookie 验证，服务端连接后立即下发 hello ack
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
    // 异常断开时先探测会话是否仍有效：未登录（302）则整页刷新回登录页，
    // 已登录则交给指数退避重连（覆盖服务重启后旧会话失效的场景）
    if (event.code !== 1000) {
      void checkSessionAndMaybeReload()
    }
    // 断开期间所有未完成的 invoke 立即失败
    rejectPendingInvokes('web bridge disconnected')
    scheduleReconnect()
  }
}

// ---- window.electron / window.api（本 shim 对浏览器暴露的完整 IPC 面）----
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
    }
  }
}

window.electron = electronAPI

connect()
