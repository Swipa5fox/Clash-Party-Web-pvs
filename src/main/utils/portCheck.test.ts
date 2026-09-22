import net from 'net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPortOccupied } from './portCheck'

// logger 依赖 dirs/electron，单测里隔离掉，只验证探测逻辑
vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const runningServers: net.Server[] = []

function listenOnRandomPort(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve(address.port)
      else reject(new Error('no port assigned'))
    })
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

// 借系统分配一个端口再释放，得到当前空闲端口
async function freePort(): Promise<number> {
  const server = net.createServer()
  const port = await listenOnRandomPort(server)
  await closeServer(server)
  return port
}

afterEach(async () => {
  await Promise.all(runningServers.map(closeServer))
  runningServers.length = 0
})

describe('checkPortOccupied', () => {
  it('空闲端口不判占用', async () => {
    const port = await freePort()
    await expect(checkPortOccupied(port)).resolves.toEqual({ occupied: false })
  })

  it('本机已监听端口判为占用(内核自身端口/容器内服务)', async () => {
    const server = net.createServer()
    runningServers.push(server)
    const port = await listenOnRandomPort(server)

    const result = await checkPortOccupied(port)

    expect(result.occupied).toBe(true)
    expect(result.source).toBe('local')
  })

  it('非法端口直接放行，不视为占用', async () => {
    await expect(checkPortOccupied(0)).resolves.toEqual({
      occupied: false,
      detail: 'invalid port'
    })
    await expect(checkPortOccupied(70000)).resolves.toEqual({
      occupied: false,
      detail: 'invalid port'
    })
  })

  it('回环/通配地址不做连接探测，避免命中自身造成误报', async () => {
    const port = await freePort()
    await expect(
      checkPortOccupied(port, ['127.0.0.1', 'localhost', '', '0.0.0.0'])
    ).resolves.toEqual({ occupied: false })
  })
})
