import type { Pool } from 'pg'

export interface LogQueryResult {
  id: number
  ts: number
  level: string
  module: string | null
  message: string
}

export interface LogsPage {
  total: number
  rows: LogQueryResult[]
}

export interface LogQueryFilter {
  level?: string
  keyword?: string
  startTime?: number
  endTime?: number
  limit?: number
  offset?: number
}

export async function queryLogs(pool: Pool | null, filter: LogQueryFilter): Promise<LogsPage> {
  if (!pool) return { total: 0, rows: [] }

  const where: string[] = []
  const params: unknown[] = []
  const add = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }
  if (filter.level) where.push(`level = ${add(filter.level)}`)
  if (filter.keyword) where.push(`message ILIKE ${add(`%${filter.keyword}%`)}`)
  if (filter.startTime !== undefined)
    where.push(`ts >= to_timestamp(${add(filter.startTime)}/1000.0)`)
  if (filter.endTime !== undefined) where.push(`ts <= to_timestamp(${add(filter.endTime)}/1000.0)}`)
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''

  const total = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM logs${whereSql}`,
    params
  )
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)
  const rows = await pool.query(
    `SELECT id, (extract(epoch FROM ts) * 1000)::bigint AS ts, level, module, message FROM logs${whereSql} ORDER BY id DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params
  )

  return {
    total: Number(total.rows[0]?.count ?? 0),
    rows: rows.rows.map((r) => ({
      id: Number(r.id),
      ts: Number(r.ts),
      level: r.level,
      module: r.module,
      message: r.message
    }))
  }
}

export async function clearLogs(pool: Pool | null): Promise<void> {
  if (!pool) return
  await pool.query('DELETE FROM logs')
}
