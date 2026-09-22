import { existsSync, statSync } from 'fs'
import http from 'http'
import net from 'net'
import path from 'path'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (...args: any[]) => Promise<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncFn = (...args: any[]) => any

export type RpcResult = { ok: true; data: unknown } | { ok: false; error: string }
export type RpcFn = (channel: string, args: unknown[]) => Promise<RpcResult>

export interface WebBridgeOptions {
  port?: number
  host?: string
  token: string
  platform: string
  version: string
  staticRoot: string
  devServerUrl?: string
  authTimeoutMs?: number
  rpc?: RpcFn
  blockedChannels?: readonly string[]
  onSend?: (channel: string, args: unknown[]) => void
}

// web 模式下拒绝的危险 channel：可杀死主进程 / 触发宿主模态弹窗（阻塞桥连接）/
// 宿主 GUI 专属能力 / 路径暴露。GUI 模式的 ipcMain 注册不受影响。
export const WEB_BLOCKED_CHANNELS: readonly string[] = [
  'restartAsAdmin',
  'requestTunPermissions',
  'showTunPermissionDialog',
  'showErrorDialog',
  'grantTunPermissions',
  'manualGrantCorePermition',
  'quitWithoutCore',
  'relaunchApp',
  'quitApp',
  'resetAppConfig',
  'downloadAndInstallUpdate',
  'getFilePath',
  'readTextFile',
  'openFile',
  'openUWPTool',
  'showTrayIcon',
  'showFloatingWindow',
  'showContextMenu',
  'startMonitor',
  'registerShortcut',
  'readImageFileDataURL',
  'exportGistAgeSecretKey'
]

export interface WebBridgeHandle {
  broadcast(channel: string, payload?: unknown): void
  close(): Promise<void>
  port: number
}

const NOT_BUILT_MESSAGE =
  'Web UI assets are not built yet. Run the renderer build first or configure devServerUrl.'

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function stringifyError(e: unknown): string {
  return String((e as { message?: unknown })?.message || e)
}

export function createRpcRouter(
  asyncHandlers: Record<string, AsyncFn>,
  syncHandlers: Record<string, SyncFn>,
  blockedChannels?: readonly string[]
): RpcFn {
  const blocked = blockedChannels ? new Set(blockedChannels) : undefined
  return async (channel, args) => {
    let handler: AsyncFn | SyncFn | undefined
    if (hasOwn(asyncHandlers, channel)) {
      handler = asyncHandlers[channel]
    } else if (hasOwn(syncHandlers, channel)) {
      handler = syncHandlers[channel]
    }
    if (!handler) {
      return { ok: false, error: `unknown channel: ${channel}` }
    }
    if (blocked?.has(channel)) {
      return { ok: false, error: `channel blocked in web mode: ${channel}` }
    }
    try {
      return { ok: true, data: await handler(...args) }
    } catch (e) {
      return { ok: false, error: stringifyError(e) }
    }
  }
}

// Deep-converts a value before JSON.stringify: a plain JSON.stringify replacer cannot catch
// Buffer because Buffer#toJSON runs before any replacer (ECMA-262 SerializeJSONProperty).
export function serializeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __buf: value.toString('base64') }
  }
  if (value && typeof (value as { toDataURL?: unknown }).toDataURL === 'function') {
    return { __img: (value as { toDataURL: () => string }).toDataURL() }
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }
  if (value && typeof value === 'object') {
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return value // JSON.stringify applies toJSON natively (Date, ...)
    }
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = serializeValue(val)
    }
    return out
  }
  return value
}

// dev 模式（devServerUrl 非空，来自 electron-vite 的 ELECTRON_RENDERER_URL）下把请求
// 反代到 Vite dev server，让渲染层源码改动刷新即生效，不必先 `electron-vite build`。
// 关键是**保持 :3999 同源**：渲染层 shim 用 location.host 拼 WS 地址，一旦把页面跳到
// Vite 自己的端口，桥接就断了。
// 容器/生产里 devServerUrl 为空，以下代码完全不参与，行为与从前一致。
function createDevProxy(devServerUrl: string): {
  handler: express.RequestHandler
  upgrade: (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void
} {
  const target = new URL(devServerUrl)
  const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)

  // Host 必须改写成 Vite 自己的值：Vite 的 allowedHosts 只认 localhost/127.0.0.1，
  // 沿用 "127.0.0.1:3999" 会被 403 Blocked request。
  const handler: express.RequestHandler = (req, res, next) => {
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: target.host }
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers as http.OutgoingHttpHeaders)
        proxyRes.pipe(res)
      }
    )
    // Vite 没起来：退回下面的静态产物兜底，而不是直接 502
    proxyReq.on('error', () => next())
    req.pipe(proxyReq)
  }

  // HMR 的 WebSocket 必须一并转发：否则 Vite 客户端连不上，转而 ping 到 /__vite_ping
  // 发现服务还活着，就整页 reload —— 会变成刷新死循环。
  const upgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer): void => {
    const upstream = net.connect(port, target.hostname, () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
      const headers = req.rawHeaders
      for (let i = 0; i < headers.length; i += 2) {
        const name = headers[i].toLowerCase()
        // Host 与 Origin 都得改写成 Vite 自己的：Vite 既按 allowedHosts 校验 Host，
        // 也直接拒绝跨源 Origin（回 400）——不改写 HMR 永远握不上手。
        const value =
          name === 'host' ? target.host : name === 'origin' ? target.origin : headers[i + 1]
        raw += `${headers[i]}: ${value}\r\n`
      }
      upstream.write(`${raw}\r\n`)
      if (head?.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  }

  return { handler, upgrade }
}

export async function startWebBridge(opts: WebBridgeOptions): Promise<WebBridgeHandle> {
  const port = opts.port ?? (Number(process.env.CP_WEB_PORT) || 3999)
  const host = opts.host ?? process.env.CP_WEB_HOST ?? '127.0.0.1'
  const authTimeoutMs = opts.authTimeoutMs ?? 5000
  const blockedInWeb = new Set(opts.blockedChannels ?? [])
  const rpc: RpcFn =
    opts.rpc ??
    (async (channel: string): Promise<RpcResult> => {
      if (blockedInWeb.has(channel)) {
        return { ok: false, error: `channel blocked in web mode: ${channel}` }
      }
      return { ok: false, error: `unknown channel: ${channel}` }
    })
  const webHtmlPath = path.join(opts.staticRoot, 'web.html')
  const devProxy = opts.devServerUrl ? createDevProxy(opts.devServerUrl) : undefined

  const staticRootExists = (): boolean => {
    try {
      return existsSync(opts.staticRoot) && statSync(opts.staticRoot).isDirectory()
    } catch {
      return false
    }
  }

  const serveWebHtml = (res: express.Response): void => {
    res.sendFile(webHtmlPath, (err) => {
      if (err && !res.headersSent) {
        res.status(503).type('text/plain').send(NOT_BUILT_MESSAGE)
      }
    })
  }

  const app = express()

  app.get('/', (req, res, next) => {
    if (devProxy) {
      // dev：本端口提供 Vite 的 web.html（而不是 Vite root 的 index.html，那是桌面端入口），
      // 并原样保留 query，否则 ?token= 丢了桥接会鉴权失败。
      const queryIndex = req.url.indexOf('?')
      req.url = `/web.html${queryIndex === -1 ? '' : req.url.slice(queryIndex)}`
      devProxy.handler(req, res, next)
      return
    }
    if (staticRootExists()) {
      serveWebHtml(res)
      return
    }
    res.status(503).type('text/plain').send(NOT_BUILT_MESSAGE)
  })

  app.get('/index.html', (_req, res) => {
    res.redirect(301, '/')
  })

  // dev：/@vite/client、/src/**、/node_modules/.vite/** 等一律交给 Vite（Vite 挂了才落到下面兜底）
  if (devProxy) {
    app.use(devProxy.handler)
  }

  app.use(express.static(opts.staticRoot))

  app.use((_req, res) => {
    if (staticRootExists()) {
      serveWebHtml(res)
      return
    }
    res.status(503).type('text/plain').send(NOT_BUILT_MESSAGE)
  })

  const server = http.createServer(app)
  // 不用 { server, path: '/ws' } 形式：ws 遇到路径不匹配的 upgrade 会直接 abortHandshake(400)，
  // 把 dev 下要转发给 Vite 的 HMR 连接先手打死。改成手动分发。
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      return
    }
    if (devProxy) {
      devProxy.upgrade(req, socket as net.Socket, head)
      return
    }
    // 与旧行为一致：未知 upgrade 路径回 400 后断开
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
  })

  const sockets = new Set<WebSocket>()
  const authedClients = new Set<WebSocket>()
  const helloAck = { type: 'hello', ok: true, platform: opts.platform, version: opts.version }

  const sendJson = (ws: WebSocket, msg: unknown): void => {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(serializeValue(msg)))
    } catch {
      // ignore per-client serialization/send failures
    }
  }

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    sockets.add(ws)
    let authed = false
    let authTimer: NodeJS.Timeout | undefined

    const rejectAuth = (): void => {
      ws.close(4001, 'unauthorized')
    }

    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.searchParams.get('token') === opts.token) {
        authed = true
        authedClients.add(ws)
        sendJson(ws, helloAck)
      }
    } catch {
      // malformed request URL: stay unauthenticated
    }

    if (!authed) {
      authTimer = setTimeout(() => {
        if (!authed) rejectAuth()
      }, authTimeoutMs)
    }

    ws.on('message', (raw) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      const record = msg as {
        type?: unknown
        token?: unknown
        id?: unknown
        channel?: unknown
        args?: unknown
      }

      if (!authed) {
        if (record.type === 'hello' && record.token === opts.token) {
          authed = true
          if (authTimer) clearTimeout(authTimer)
          authTimer = undefined
          authedClients.add(ws)
          sendJson(ws, helloAck)
        } else {
          rejectAuth()
        }
        return
      }

      if (record.type === 'invoke') {
        const channel = typeof record.channel === 'string' ? record.channel : ''
        const args = Array.isArray(record.args) ? record.args : []
        void rpc(channel, args)
          .then((result) => {
            if (result.ok) {
              sendJson(ws, { type: 'result', id: record.id, ok: true, data: result.data })
            } else {
              sendJson(ws, { type: 'result', id: record.id, ok: false, error: result.error })
            }
          })
          .catch((e: unknown) => {
            sendJson(ws, { type: 'result', id: record.id, ok: false, error: stringifyError(e) })
          })
        return
      }

      if (record.type === 'send') {
        const channel = typeof record.channel === 'string' ? record.channel : ''
        const args = Array.isArray(record.args) ? record.args : []
        try {
          opts.onSend?.(channel, args)
        } catch {
          // ignore onSend failures to keep the bridge alive
        }
        return
      }
    })

    const cleanup = (): void => {
      sockets.delete(ws)
      authedClients.delete(ws)
      if (authTimer) clearTimeout(authTimer)
      authTimer = undefined
    }
    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    broadcast(channel: string, payload?: unknown): void {
      for (const ws of authedClients) {
        sendJson(ws, { type: 'event', channel, payload })
      }
    },
    async close(): Promise<void> {
      for (const ws of sockets) {
        try {
          ws.terminate()
        } catch {
          // already closed
        }
      }
      sockets.clear()
      authedClients.clear()
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
    port: actualPort
  }
}
