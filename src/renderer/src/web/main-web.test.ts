import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Web 模式 shim 的行为契约：桥断开时，会重启内核的通道按"已下发"兑现，
// 其余在途调用报错；还没发出去的调用留在队列里等重连后冲刷。

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 1
  sent: string[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number }) => void

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  emitClose(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code })
  }

  emitHello(): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'hello', ok: true }) })
  }
}

interface ShimApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

vi.mock('../main', () => ({}))

function setupGlobals(): void {
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    window: globalThis,
    location: { protocol: 'http:', host: '127.0.0.1:3999' },
    document: { getElementById: () => null }
  })
}

function lastSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1)
  if (!socket) throw new Error('no socket created')
  return socket
}

async function loadShim(): Promise<{ socket: FakeSocket; api: ShimApi }> {
  await vi.resetModules()
  await import('./main-web')
  const socket = lastSocket()
  socket.emitHello()
  const api = (globalThis as unknown as { electron: { ipcRenderer: ShimApi } }).electron.ipcRenderer
  return { socket, api }
}

describe('web IPC shim', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
    setupGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('重连类通道断开时按已下发兑现，其余在途调用失败', async () => {
    const { socket, api } = await loadShim()

    const restart = api.invoke('restartCore')
    const upgrade = api.invoke('mihomoUpgrade')
    const poll = api.invoke('mihomoProxies')
    expect(socket.sent).toHaveLength(3)

    socket.emitClose()

    await expect(restart).resolves.toBeUndefined()
    await expect(upgrade).resolves.toBeUndefined()
    await expect(poll).rejects.toBe('web bridge disconnected')
  })

  it('断开期间发出的调用留在队列里，重连 hello 后冲刷', async () => {
    const { socket, api } = await loadShim()

    socket.emitClose()
    const queued = api.invoke('getAppConfig')
    expect(socket.sent).toHaveLength(0)

    vi.advanceTimersByTime(1000)
    const reconnected = lastSocket()
    expect(reconnected).not.toBe(socket)
    reconnected.emitHello()
    expect(reconnected.sent).toHaveLength(1)

    reconnected.onmessage?.({
      data: JSON.stringify({ type: 'result', id: 1, ok: true, data: { language: 'zh-CN' } })
    })
    await expect(queued).resolves.toEqual({ language: 'zh-CN' })
  })
})
