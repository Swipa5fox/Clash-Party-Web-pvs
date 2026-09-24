import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import {
  createRpcRouter,
  serializeValue,
  startWebBridge,
  WEB_BLOCKED_CHANNELS,
  type WebBridgeHandle
} from './webBridge'

// web-auth.json 必须落在临时目录，避免读写真实 dataDir / 依赖用户已改过的凭据
const { mockDataDir } = vi.hoisted(() => ({ mockDataDir: { value: '' } }))
vi.mock('../utils/dirs', () => ({ dataDir: () => mockDataDir.value }))

interface BridgeMessage {
  type: string
  ok?: boolean
  id?: number
  channel?: string
  payload?: unknown
  data?: unknown
  error?: string
  platform?: string
  version?: string
}

let handle: WebBridgeHandle
let onSend: ReturnType<typeof vi.fn>
let wsUrl: string
let httpOrigin: string
let staticRoot: string
let sessionCookie: string

beforeAll(async () => {
  mockDataDir.value = mkdtempSync(join(tmpdir(), 'cp-web-auth-'))
  staticRoot = mkdtempSync(join(tmpdir(), 'cp-web-static-'))
  writeFileSync(join(staticRoot, 'web.html'), '<!DOCTYPE html><html><body>app</body></html>')
  onSend = vi.fn()
  const rpc = createRpcRouter(
    {
      echo: async (v: unknown) => ({ echoed: v }),
      fail: async () => {
        throw new Error('boom')
      },
      returnBuffer: async () => Buffer.from('hello')
    },
    { syncDouble: (n: number) => n * 2 }
  )
  handle = await startWebBridge({
    port: 0,
    platform: 'test-platform',
    version: '1.2.3',
    staticRoot,
    rpc,
    onSend
  })
  httpOrigin = `http://127.0.0.1:${handle.port}`
  wsUrl = `ws://127.0.0.1:${handle.port}/ws`
})

afterAll(async () => {
  await handle.close()
})

// 登录（默认凭据 admin/admin123）并返回 Set-Cookie 中的会话串
async function login(username = 'admin', password = 'admin123'): Promise<Response> {
  return fetch(`${httpOrigin}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
}

function connect(url = wsUrl, cookie?: string): WebSocket {
  const ws = cookie ? new WebSocket(url, { headers: { cookie } }) : new WebSocket(url)
  ws.on('error', () => {})
  return ws
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('open', () => resolve())
  })
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<BridgeMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs)
    ws.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(String(raw)) as BridgeMessage)
    })
  })
}

async function connectAuthed(): Promise<WebSocket> {
  if (!sessionCookie) {
    const res = await login()
    expect(res.status).toBe(200)
    sessionCookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const ws = connect(wsUrl, sessionCookie)
  const helloP = nextMessage(ws)
  await opened(ws)
  expect(await helloP).toEqual({
    type: 'hello',
    ok: true,
    platform: 'test-platform',
    version: '1.2.3'
  })
  return ws
}

function invoke(
  ws: WebSocket,
  id: number,
  channel: string,
  args: unknown[] = []
): Promise<BridgeMessage> {
  ws.send(JSON.stringify({ type: 'invoke', id, channel, args }))
  return nextMessage(ws)
}

describe('web auth flow (cookie session)', () => {
  it('redirects unauthenticated page requests to /login', async () => {
    const res = await fetch(`${httpOrigin}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('serves the login page without a session', async () => {
    const res = await fetch(`${httpOrigin}/login`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('/api/login')
  })

  it('rejects a wrong password with 401', async () => {
    const res = await login('admin', 'wrong-password')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ ok: false })
  })

  it('logs in with default credentials and sets a session cookie', async () => {
    const res = await login()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('cp_session=')
    expect(cookie).toContain('HttpOnly')
  })

  it('serves the app page with a valid session cookie', async () => {
    if (!sessionCookie) {
      const res0 = await login()
      sessionCookie = (res0.headers.get('set-cookie') ?? '').split(';')[0]
    }
    const res = await fetch(`${httpOrigin}/`, {
      redirect: 'manual',
      headers: { cookie: sessionCookie }
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('app')
  })

  it('rejects a websocket upgrade without a session cookie', async () => {
    const ws = connect()
    const statusCode = await new Promise<number>((resolve) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.once('close', () => resolve(0))
    })
    expect(statusCode).toBe(401)
    ws.close()
  })

  it('sends hello ack immediately on an authenticated websocket', async () => {
    const ws = await connectAuthed()
    ws.close()
  })
})

describe('webBridge rpc', () => {
  it('resolves invoke with the async handler value', async () => {
    const ws = await connectAuthed()
    expect(await invoke(ws, 1, 'echo', ['x'])).toEqual({
      type: 'result',
      id: 1,
      ok: true,
      data: { echoed: 'x' }
    })
    ws.close()
  })

  it('rejects invoke for an unknown channel', async () => {
    const ws = await connectAuthed()
    expect(await invoke(ws, 2, 'nope')).toEqual({
      type: 'result',
      id: 2,
      ok: false,
      error: 'unknown channel: nope'
    })
    ws.close()
  })

  it('rejects invoke when the handler throws', async () => {
    const ws = await connectAuthed()
    expect(await invoke(ws, 3, 'fail')).toEqual({
      type: 'result',
      id: 3,
      ok: false,
      error: 'boom'
    })
    ws.close()
  })

  it('routes sync handlers', async () => {
    const ws = await connectAuthed()
    expect(await invoke(ws, 4, 'syncDouble', [21])).toEqual({
      type: 'result',
      id: 4,
      ok: true,
      data: 42
    })
    ws.close()
  })

  it('serializes Buffer results as base64 via the replacer', async () => {
    const ws = await connectAuthed()
    const res = await invoke(ws, 5, 'returnBuffer')
    expect(res.ok).toBe(true)
    expect((res.data as { __buf: string }).__buf).toBe(Buffer.from('hello').toString('base64'))
    ws.close()
  })

  it('ignores messages that fail JSON.parse', async () => {
    const ws = await connectAuthed()
    ws.send('not-json')
    expect(await invoke(ws, 6, 'syncDouble', [1])).toEqual({
      type: 'result',
      id: 6,
      ok: true,
      data: 2
    })
    ws.close()
  })
})

describe('webBridge events', () => {
  it('forwards send messages to onSend', async () => {
    const ws = await connectAuthed()
    const seen = new Promise<[string, unknown[]]>((resolve) => {
      onSend.mockImplementationOnce((channel: string, args: unknown[]) => resolve([channel, args]))
    })
    ws.send(JSON.stringify({ type: 'send', channel: 'updateTrayMenu', args: [1, 'two'] }))
    expect(await seen).toEqual(['updateTrayMenu', [1, 'two']])
    ws.close()
  })

  it('broadcasts events to all authed clients', async () => {
    const wsA = await connectAuthed()
    const wsB = await connectAuthed()
    const evA = nextMessage(wsA)
    const evB = nextMessage(wsB)
    handle.broadcast('groupsUpdated', { name: 'PROXY' })
    expect(await evA).toEqual({
      type: 'event',
      channel: 'groupsUpdated',
      payload: { name: 'PROXY' }
    })
    expect(await evB).toEqual({
      type: 'event',
      channel: 'groupsUpdated',
      payload: { name: 'PROXY' }
    })
    wsA.close()
    wsB.close()
  })
})

describe('serializeValue', () => {
  it('encodes Buffer as a base64 payload', () => {
    const encoded = JSON.parse(JSON.stringify(serializeValue({ data: Buffer.from('clash-party') })))
    expect(encoded).toEqual({ data: { __buf: Buffer.from('clash-party').toString('base64') } })
  })

  it('encodes nested Buffers inside arrays and objects', () => {
    const encoded = JSON.parse(JSON.stringify(serializeValue({ list: [Buffer.from('a')] })))
    expect(encoded).toEqual({ list: [{ __buf: Buffer.from('a').toString('base64') }] })
  })

  it('encodes nativeImage-like objects with toDataURL', () => {
    const encoded = JSON.parse(
      JSON.stringify(serializeValue({ data: { toDataURL: () => 'data:image/png;base64,xx' } }))
    )
    expect(encoded).toEqual({ data: { __img: 'data:image/png;base64,xx' } })
  })

  it('keeps undefined as undefined and leaves toJSON objects to JSON.stringify', () => {
    expect(serializeValue(undefined)).toBeUndefined()
    const encoded = JSON.parse(JSON.stringify(serializeValue({ at: new Date(0) })))
    expect(encoded).toEqual({ at: '1970-01-01T00:00:00.000Z' })
  })
})

describe('WEB_BLOCKED_CHANNELS', () => {
  it('stays empty now that desktop-only handlers are removed', () => {
    // 历史上收录的 13 条危险通道已随桌面专属 handler 删除；若未来重新注册
    // 危险通道，应同步登记到屏蔽表并恢复此处断言。
    expect(WEB_BLOCKED_CHANNELS).toEqual([])
  })

  it('contains no duplicates', () => {
    expect(new Set(WEB_BLOCKED_CHANNELS).size).toBe(WEB_BLOCKED_CHANNELS.length)
  })
})

describe('createRpcRouter blocked channels', () => {
  it('rejects a blocked async channel without executing the handler', async () => {
    const restartAsAdmin = vi.fn(async () => 'should-not-run')
    const rpc = createRpcRouter({ restartAsAdmin }, {}, ['restartAsAdmin'])
    expect(await rpc('restartAsAdmin', [])).toEqual({
      ok: false,
      error: 'channel blocked in web mode: restartAsAdmin'
    })
    expect(restartAsAdmin).not.toHaveBeenCalled()
  })

  it('rejects a blocked sync channel without executing the handler', async () => {
    const quitApp = vi.fn(() => 'should-not-run')
    const rpc = createRpcRouter({}, { quitApp }, ['quitApp'])
    expect(await rpc('quitApp', [])).toEqual({
      ok: false,
      error: 'channel blocked in web mode: quitApp'
    })
    expect(quitApp).not.toHaveBeenCalled()
  })

  it('keeps non-blocked channels working when a blocklist is set', async () => {
    const rpc = createRpcRouter(
      { echo: async (v: unknown) => ({ echoed: v }) },
      { syncDouble: (n: number) => n * 2 },
      WEB_BLOCKED_CHANNELS
    )
    expect(await rpc('echo', ['x'])).toEqual({ ok: true, data: { echoed: 'x' } })
    expect(await rpc('syncDouble', [2])).toEqual({ ok: true, data: 4 })
  })

  it('keeps unknown channel semantics for blocked names without a handler', async () => {
    const rpc = createRpcRouter({}, {}, WEB_BLOCKED_CHANNELS)
    expect(await rpc('resetAppConfig', [])).toEqual({
      ok: false,
      error: 'unknown channel: resetAppConfig'
    })
  })

  it('keeps unknown channel semantics for channels outside the blocklist', async () => {
    const rpc = createRpcRouter({}, {}, WEB_BLOCKED_CHANNELS)
    expect(await rpc('nope', [])).toEqual({ ok: false, error: 'unknown channel: nope' })
  })

  it('behaves unchanged without the third argument', async () => {
    const quitApp = vi.fn(() => 'ok-quit')
    const rpc = createRpcRouter({}, { quitApp })
    expect(await rpc('quitApp', [])).toEqual({ ok: true, data: 'ok-quit' })
    expect(quitApp).toHaveBeenCalledTimes(1)
    expect(await rpc('nope', [])).toEqual({ ok: false, error: 'unknown channel: nope' })
  })
})

describe('webBridge blocked channels wiring', () => {
  let blockedHandle: WebBridgeHandle
  let blockedWsUrl: string
  let blockedHttpOrigin: string

  beforeAll(async () => {
    blockedHandle = await startWebBridge({
      port: 0,
      platform: 'test-platform',
      version: '1.2.3',
      staticRoot: join(tmpdir(), 'clash-party-web-bridge-blocked-no-assets'),
      blockedChannels: ['quitApp']
    })
    blockedWsUrl = `ws://127.0.0.1:${blockedHandle.port}/ws`
    blockedHttpOrigin = `http://127.0.0.1:${blockedHandle.port}`
  })

  afterAll(async () => {
    await blockedHandle.close()
  })

  async function connectAuthedBlocked(): Promise<WebSocket> {
    const res = await fetch(`${blockedHttpOrigin}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
    const ws = connect(blockedWsUrl, cookie)
    const helloP = nextMessage(ws)
    await opened(ws)
    await helloP
    return ws
  }

  it('blocks a blacklisted channel without a custom rpc', async () => {
    const ws = await connectAuthedBlocked()
    expect(await invoke(ws, 1, 'quitApp')).toEqual({
      type: 'result',
      id: 1,
      ok: false,
      error: 'channel blocked in web mode: quitApp'
    })
    ws.close()
  })

  it('keeps unknown channel semantics for other channels', async () => {
    const ws = await connectAuthedBlocked()
    expect(await invoke(ws, 2, 'getAppConfig')).toEqual({
      type: 'result',
      id: 2,
      ok: false,
      error: 'unknown channel: getAppConfig'
    })
    ws.close()
  })
})
