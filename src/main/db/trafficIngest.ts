import { broadcastEvent } from '../resolve/broadcaster'
import { getPool, isDbEnabled } from './index'
import { createLogger } from '../utils/logger'

const ingestLogger = createLogger('TrafficIngest')

const FLUSH_INTERVAL_MS = 5000
const MAX_BUFFER = 10_000
const RETENTION_DAYS = 30

export interface TrafficLogRow {
  timestamp: number
  sourceIP: string
  host: string
  outbound: string
  process: string
  upload: number
  download: number
}

interface TrafficSnapshot {
  upload: number
  download: number
}

let started = false
let enabled = false
let buffer: TrafficLogRow[] = []
let flushTimer: NodeJS.Timeout | null = null
let lastCleanupDay = 0

export function startTrafficIngest(): void {
  if (started) return
  started = true
  enabled = isDbEnabled()
  if (!enabled) {
    ingestLogger.info('CP_DATABASE_URL not set; traffic ingest disabled')
    return
  }
  enabledAt = Date.now()
  lastTotals = { upload: 0, download: 0 }
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  flushTimer.unref()
  ingestLogger.info('Traffic ingest started')
}

// UI 开关：关闭即停采集并丢缓冲；重开重新起 enabledAt（不记旧连接初始快照）
export function setTrafficIngestEnabled(value: boolean): void {
  if (!started) return
  if (value === enabled) return
  enabled = value
  if (value) {
    enabledAt = Date.now()
    lastTotals = { upload: 0, download: 0 }
    ingestLogger.info('Traffic ingest resumed')
  } else {
    connectionLastData.clear()
    buffer = []
    ingestLogger.info('Traffic ingest paused')
  }
}

// 与原渲染层 use-traffic-logger 相同的 delta 状态：按连接 id 记上次值，
// 内核重启（totals 回退）时清空，新连接只记 enable 之后开始的初始快照。
const connectionLastData = new Map<string, TrafficSnapshot>()
let lastTotals = { upload: 0, download: 0 }
let enabledAt = 0

export function stopTrafficIngest(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  started = false
  enabled = false
  connectionLastData.clear()
}

export function isTrafficIngestActive(): boolean {
  return enabled
}

// 测试窥探口：断言缓冲内容（生产代码勿用）
export function __testBufferLength(): number {
  return buffer.length
}

export function __testRows(): TrafficLogRow[] {
  return buffer
}

// 挂在主进程 mihomoConnections 订阅上（broadcastEvent 的旁路消费者，不影响浏览器推送）
export function handleConnectionsInfo(info: IMihomoConnectionsInfo): void {
  if (!enabled) return

  const uploadTotal = info.uploadTotal || 0
  const downloadTotal = info.downloadTotal || 0
  if (uploadTotal < lastTotals.upload || downloadTotal < lastTotals.download) {
    connectionLastData.clear()
    buffer = []
  }
  lastTotals = { upload: uploadTotal, download: downloadTotal }

  const connections = info.connections ?? []
  if (connections.length === 0) {
    connectionLastData.clear()
    return
  }

  const now = Date.now()
  const activeIds = new Set<string>()

  for (const conn of connections) {
    activeIds.add(conn.id)
    const currentUpload = conn.upload || 0
    const currentDownload = conn.download || 0
    const last = connectionLastData.get(conn.id)
    connectionLastData.set(conn.id, { upload: currentUpload, download: currentDownload })

    const startAt = Date.parse(conn.start)
    const isInitial = Number.isFinite(startAt) && startAt >= enabledAt
    const uploadDelta = last
      ? Math.max(0, currentUpload - last.upload)
      : isInitial
        ? currentUpload
        : 0
    const downloadDelta = last
      ? Math.max(0, currentDownload - last.download)
      : isInitial
        ? currentDownload
        : 0
    if (uploadDelta === 0 && downloadDelta === 0) continue

    buffer.push({
      timestamp: now,
      sourceIP: conn.metadata.sourceIP || 'Inner',
      host: conn.metadata.host || conn.metadata.destinationIP || 'Unknown',
      process: conn.metadata.process || 'Unknown',
      outbound: conn.chains?.[0] || 'DIRECT',
      upload: uploadDelta,
      download: downloadDelta
    })
  }

  for (const id of connectionLastData.keys()) {
    if (!activeIds.has(id)) connectionLastData.delete(id)
  }

  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER)
    ingestLogger.warn(`Traffic ingest buffer capped at ${MAX_BUFFER}; oldest rows dropped`)
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const rows = buffer
  buffer = []
  const pool = await getPool()
  if (!pool) {
    buffer = [...rows.reverse(), ...buffer].slice(0, MAX_BUFFER)
    return
  }
  const values: unknown[] = []
  const placeholders = rows.map((row, i) => {
    const base = i * 7
    values.push(
      new Date(row.timestamp),
      row.sourceIP,
      row.host,
      row.outbound,
      row.process,
      row.upload,
      row.download
    )
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`
  })
  try {
    await pool.query(
      `INSERT INTO data_usage_logs (ts, source_ip, host, outbound, process, upload, download) VALUES ${placeholders.join(',')}`,
      values
    )
  } catch (e) {
    ingestLogger.warn('Traffic flush failed', e)
    buffer = [...rows.reverse(), ...buffer].slice(0, MAX_BUFFER)
  }
  await cleanupOncePerDay()
}

// 替代原渲染层的 RETENTION_MS 30 天清理，每天首笔 flush 时执行一次
async function cleanupOncePerDay(): Promise<void> {
  const today = Math.floor(Date.now() / 86_400_000)
  if (today === lastCleanupDay) return
  lastCleanupDay = today
  const pool = await getPool()
  if (!pool) return
  try {
    const r = await pool.query(
      'DELETE FROM data_usage_logs WHERE ts < now() - make_interval(days => $1)',
      [RETENTION_DAYS]
    )
    if (r.rowCount && r.rowCount > 0) {
      ingestLogger.info(
        `Retention cleanup removed ${r.rowCount} rows older than ${RETENTION_DAYS}d`
      )
    }
  } catch (e) {
    ingestLogger.warn('Retention cleanup failed', e)
  }
}

export async function clearTrafficLogs(): Promise<void> {
  const pool = await getPool()
  if (!pool) return
  await pool.query('DELETE FROM data_usage_logs')
  broadcastEvent('dataUsageCleared')
}

export async function importTrafficLogs(logs: TrafficLogRow[]): Promise<number> {
  const pool = await getPool()
  if (!pool) throw new Error('database not configured')
  let imported = 0
  const CHUNK = 500
  for (let i = 0; i < logs.length; i += CHUNK) {
    const chunk = logs.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders = chunk.map((row, j) => {
      const base = j * 7
      values.push(
        new Date(row.timestamp),
        row.sourceIP,
        row.host,
        row.outbound,
        row.process,
        row.upload,
        row.download
      )
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`
    })
    await pool.query(
      `INSERT INTO data_usage_logs (ts, source_ip, host, outbound, process, upload, download) VALUES ${placeholders.join(',')}`,
      values
    )
    imported += chunk.length
  }
  return imported
}
