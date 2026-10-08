import { describe, expect, it, vi, beforeEach } from 'vitest'

// 隔离模块级状态：每个用例重新 import 拿干净闭包
async function freshModule() {
  vi.resetModules()
  return await import('./trafficIngest')
}

function makeConn(
  id: string,
  upload: number,
  download: number,
  start: string = new Date().toISOString()
): IMihomoConnectionDetail {
  return {
    id,
    upload,
    download,
    start,
    chains: ['PROXY'],
    metadata: { sourceIP: '192.168.1.5', host: 'example.com', destinationIP: '1.2.3.4' }
  } as unknown as IMihomoConnectionDetail
}

function makeInfo(conns: IMihomoConnectionDetail[], uploadTotal = 0, downloadTotal = 0) {
  return { connections: conns, uploadTotal, downloadTotal } as IMihomoConnectionsInfo
}

describe('trafficIngest handleConnectionsInfo', () => {
  beforeEach(() => {
    vi.stubEnv('CP_DATABASE_URL', 'postgres://test')
  })

  it('computes per-connection deltas between frames', async () => {
    const m = await freshModule()
    m.startTrafficIngest()
    const oldStart = new Date(Date.now() - 3600_000).toISOString()
    m.handleConnectionsInfo(makeInfo([makeConn('a', 100, 200, oldStart)], 100, 200))
    m.handleConnectionsInfo(makeInfo([makeConn('a', 150, 280, oldStart)], 150, 280))

    // 第二帧产生一条 delta 记录：+50 / +80
    expect(m.__testBufferLength()).toBe(1)
    const rows = m.__testRows()
    const row = rows[0] as { upload: number; download: number; host: string; outbound: string }
    expect(row.upload).toBe(50)
    expect(row.download).toBe(80)
    expect(row.host).toBe('example.com')
    expect(row.outbound).toBe('PROXY')
  })

  it('clears state when totals decrease (core restart)', async () => {
    const m = await freshModule()
    m.startTrafficIngest()
    const oldStart = new Date(Date.now() - 3600_000).toISOString()
    m.handleConnectionsInfo(makeInfo([makeConn('a', 500, 500, oldStart)], 500, 500))
    m.handleConnectionsInfo(makeInfo([makeConn('a', 10, 10, oldStart)], 10, 10))
    // 重启帧：buffer 被清空，初始快照不记（连接 start 早于 enabledAt）
    expect(m.__testBufferLength()).toBe(0)
  })

  it('logs initial snapshot only for connections started after ingest enabled', async () => {
    const m = await freshModule()
    m.startTrafficIngest()
    const oldStart = new Date(Date.now() - 3600_000).toISOString()
    const newStart = new Date().toISOString()
    m.handleConnectionsInfo(
      makeInfo([makeConn('old', 300, 300, oldStart), makeConn('new', 30, 40, newStart)], 330, 340)
    )
    expect(m.__testBufferLength()).toBe(1)
    const rows = m.__testRows()
    const row = rows[0] as { sourceIP: string; upload: number; download: number }
    expect(row.sourceIP).toBe('192.168.1.5')
    expect(row.upload).toBe(30)
    expect(row.download).toBe(40)
  })

  it('no-ops entirely when CP_DATABASE_URL is absent', async () => {
    vi.stubEnv('CP_DATABASE_URL', '')
    const m = await freshModule()
    m.startTrafficIngest()
    m.handleConnectionsInfo(makeInfo([makeConn('a', 100, 100)], 100, 100))
    m.handleConnectionsInfo(makeInfo([makeConn('a', 200, 200)], 200, 200))
    expect(m.isTrafficIngestActive()).toBe(false)
    expect(m.__testBufferLength()).toBe(0)
  })

  it('drops oldest rows when buffer exceeds cap', async () => {
    const m = await freshModule()
    m.startTrafficIngest()
    const info = makeInfo([makeConn('a', 1, 1)], 1, 1)
    for (let i = 0; i < 10_050; i++) {
      m.handleConnectionsInfo(makeInfo([makeConn(`c${i}`, 1, 1)], 1, 1))
    }
    expect(m.__testBufferLength()).toBeLessThanOrEqual(10_000)
    expect(info.connections).toHaveLength(1)
  })
})
