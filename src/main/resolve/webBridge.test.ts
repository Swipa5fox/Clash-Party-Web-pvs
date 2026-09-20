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

const TOKEN = 'test-token'
const AUTH_TIMEOUT_MS = 150

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

beforeAll(async () => {
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
    token: TOKEN,
    platform: 'test-platform',
    version: '1.2.3',
    staticRoot: join(tmpdir(), 'clash-party-web-bridge-no-assets'),
    authTimeoutMs: AUTH_TIMEOUT_MS,
    rpc,
    onSend
  })
  wsUrl = `ws://127.0.0.1:${handle.port}/ws`
})

afterAll(async () => {
  await handle.close()
})

function connect(url = wsUrl): WebSocket {
  const ws = new WebSocket(url)
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

function closed(ws: WebSocket, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs)
    ws.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function connectAuthed(): Promise<WebSocket> {
  const ws = connect(`${wsUrl}?token=${TOKEN}`)
  // attach the message listener before awaiting open: the hello ack for ?token= auth
  // can arrive in the same tick as the open event
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

describe('webBridge auth', () => {
  it('closes the connection when hello carries a wrong token', async () => {
    const ws = connect()
    await opened(ws)
    const closeP = closed(ws)
    ws.send(JSON.stringify({ type: 'hello', token: 'wrong-token' }))
    expect(await closeP).toBe(4001)
  })

  it('closes the connection when no hello arrives before authTimeoutMs', async () => {
    const ws = connect()
    await opened(ws)
    expect(await closed(ws, AUTH_TIMEOUT_MS + 2000)).toBe(4001)
  })

  it('closes the connection on a non-hello message before auth', async () => {
    const ws = connect()
    await opened(ws)
    const closeP = closed(ws)
    ws.send(JSON.stringify({ type: 'invoke', id: 1, channel: 'getAppConfig', args: [] }))
    expect(await closeP).toBe(4001)
  })

  it('replies hello on a correct token', async () => {
    const ws = connect()
    await opened(ws)
    const helloP = nextMessage(ws)
    ws.send(JSON.stringify({ type: 'hello', token: TOKEN }))
    expect(await helloP).toEqual({
      type: 'hello',
      ok: true,
      platform: 'test-platform',
      version: '1.2.3'
    })
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
  it('covers the dangerous channels from the spec', () => {
    for (const channel of [
      'restartAsAdmin',
      'quitApp',
      'relaunchApp',
      'quitWithoutCore',
      'resetAppConfig',
      'showTunPermissionDialog',
      'showErrorDialog',
      'readTextFile',
      'openFile',
      'exportGistAgeSecretKey'
    ]) {
      expect(WEB_BLOCKED_CHANNELS).toContain(channel)
    }
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

  beforeAll(async () => {
    blockedHandle = await startWebBridge({
      port: 0,
      token: TOKEN,
      platform: 'test-platform',
      version: '1.2.3',
      staticRoot: join(tmpdir(), 'clash-party-web-bridge-blocked-no-assets'),
      authTimeoutMs: AUTH_TIMEOUT_MS,
      blockedChannels: ['quitApp']
    })
    blockedWsUrl = `ws://127.0.0.1:${blockedHandle.port}/ws`
  })

  afterAll(async () => {
    await blockedHandle.close()
  })

  async function connectAuthedBlocked(): Promise<WebSocket> {
    const ws = connect(`${blockedWsUrl}?token=${TOKEN}`)
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
