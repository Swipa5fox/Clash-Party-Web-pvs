// 日志入库：内核 mihomoLogs 流 → PG logs 表（文件落盘不动）。
// 本模块禁止静态 import logger（db/index.ts 已静态引 logger，会成环），
// 错误直接走 console，避免「记日志失败又触发记日志」。
import type { Pool } from 'pg'

const FLUSH_INTERVAL_MS = 5000
const MAX_BUFFER = 20_000
const DEFAULT_RETENTION_DAYS = 7
const DEFAULT_MAX_ROWS = 500_000

export interface LogRow {
  ts: number
  level: string
  module: string | null
  message: string
}

let buffer: LogRow[] = []
let started = false
let flushTimer: NodeJS.Timeout | null = null
let pool: Pool | null = null
let retentionDays = DEFAULT_RETENTION_DAYS
let maxRows = DEFAULT_MAX_ROWS
let lastCleanupDay = 0

// 设置下发（app.ts 读取 config 后调用，避免本模块 import config 成环）；
// 保留天数或行数上限任一变化都重置当天清理标记，使新值尽快生效
export function setLogIngestLimits(nextRetentionDays: number, nextMaxRows: number): void {
  if (nextRetentionDays === retentionDays && nextMaxRows === maxRows) return
  retentionDays = nextRetentionDays
  maxRows = nextMaxRows
  lastCleanupDay = 0
}

export function startLogIngest(dbEnabled: boolean): void {
  if (started) return
  started = true
  if (!dbEnabled) return
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  flushTimer.unref()
}

export function stopLogIngest(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  started = false
  buffer = []
}

// 解耦 db/index：由 manager 在启动时注入（同样为避免环）
export function setLogIngestPool(p: Pool | null): void {
  pool = p
}

export function pushLog(row: LogRow): void {
  if (!started || !pool) return
  buffer.push(row)
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER)
    console.warn(`[LogIngest] buffer capped at ${MAX_BUFFER}; oldest dropped`)
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  if (!pool) return
  const rows = buffer
  buffer = []
  const values: unknown[] = []
  const placeholders = rows.map((row, i) => {
    const base = i * 4
    values.push(new Date(row.ts), row.level, row.module, row.message)
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`
  })
  try {
    await pool.query(
      `INSERT INTO logs (ts, level, module, message) VALUES ${placeholders.join(',')}`,
      values
    )
  } catch (e) {
    console.warn('[LogIngest] flush failed', e)
    buffer = [...rows.slice(-MAX_BUFFER), ...buffer].slice(0, MAX_BUFFER)
  }
  await cleanupOncePerDay()
}

async function cleanupOncePerDay(): Promise<void> {
  const today = Math.floor(Date.now() / 86_400_000)
  if (today === lastCleanupDay || !pool) return
  lastCleanupDay = today
  try {
    await pool.query('DELETE FROM logs WHERE ts < now() - make_interval(days => $1)', [
      retentionDays
    ])
    // 行数上限：超限时按 id 保留最新的 maxRows 条
    await pool.query(
      'DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id DESC OFFSET $1)',
      [maxRows]
    )
  } catch (e) {
    console.warn('[LogIngest] retention cleanup failed', e)
  }
}
