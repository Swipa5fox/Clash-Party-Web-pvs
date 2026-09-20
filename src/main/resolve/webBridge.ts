import { existsSync, statSync } from 'fs'
import http from 'http'
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

  app.get('/', (_req, res) => {
    if (staticRootExists()) {
      serveWebHtml(res)
    } else if (opts.devServerUrl) {
      res.redirect(302, `${opts.devServerUrl.replace(/\/+$/, '')}/web.html`)
    } else {
      res.status(503).type('text/plain').send(NOT_BUILT_MESSAGE)
    }
  })

  app.get('/index.html', (_req, res) => {
    res.redirect(301, '/')
  })

  app.use(express.static(opts.staticRoot))

  app.use((_req, res) => {
    if (staticRootExists()) {
      serveWebHtml(res)
      return
    }
    res.status(503).type('text/plain').send(NOT_BUILT_MESSAGE)
  })

  const server = http.createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })
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
