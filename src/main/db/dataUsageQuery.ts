import { getPool } from './index'
import type { TrafficLogRow } from './trafficIngest'

export type DataUsageType = 'sourceIP' | 'host' | 'outbound' | 'process'

export interface AggregatedData {
  label: string
  upload: number
  download: number
  total: number
  count: number
}

export interface TrafficTrendPoint {
  timestamp: number
  upload: number
  download: number
}

interface AggRow {
  label: string
  upload: string | number
  download: string | number
  count: string | number
}

const DIMENSION_COLUMNS: Record<DataUsageType, string> = {
  sourceIP: 'source_ip',
  host: 'host',
  outbound: 'outbound',
  process: 'process'
}

function toAggregatedData(rows: AggRow[]): AggregatedData[] {
  return rows
    .map((r) => ({
      label: r.label,
      upload: Number(r.upload),
      download: Number(r.download),
      total: Number(r.upload) + Number(r.download),
      count: Number(r.count)
    }))
    .sort((a, b) => b.total - a.total)
}

export async function queryTrafficOverview(
  type: DataUsageType,
  startTime: number,
  endTime: number,
  bucketSizeMs: number
): Promise<{ rankings: AggregatedData[]; trend: TrafficTrendPoint[] }> {
  const pool = await getPool()
  if (!pool) return { rankings: [], trend: [] }

  const col = DIMENSION_COLUMNS[type]
  const [rankings, trend] = await Promise.all([
    pool.query<AggRow>(
      `SELECT ${col} AS label, sum(upload) AS upload, sum(download) AS download, count(*) AS count
       FROM data_usage_logs
       WHERE ts >= to_timestamp($1/1000.0) AND ts <= to_timestamp($2/1000.0)
       GROUP BY ${col}`,
      [startTime, endTime]
    ),
    pool.query<{ bucket: Date; upload: string | number; download: string | number }>(
      `SELECT to_timestamp(floor(extract(epoch FROM ts) * 1000 / $3) * $3 / 1000.0) AS bucket,
              sum(upload) AS upload, sum(download) AS download
       FROM data_usage_logs
       WHERE ts >= to_timestamp($1/1000.0) AND ts <= to_timestamp($2/1000.0)
       GROUP BY bucket ORDER BY bucket`,
      [startTime, endTime, bucketSizeMs]
    )
  ])

  return {
    rankings: toAggregatedData(rankings.rows),
    trend: trend.rows.map((r) => ({
      timestamp: Math.floor(new Date(r.bucket).getTime() / bucketSizeMs) * bucketSizeMs,
      upload: Number(r.upload),
      download: Number(r.download)
    }))
  }
}

export async function querySubStatsByHost(
  dimension: Exclude<DataUsageType, 'host'>,
  label: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const pool = await getPool()
  if (!pool) return []
  const col = DIMENSION_COLUMNS[dimension]
  const r = await pool.query<AggRow>(
    `SELECT host AS label, sum(upload) AS upload, sum(download) AS download, count(*) AS count
     FROM data_usage_logs
     WHERE ${col} = $3 AND ts >= to_timestamp($1/1000.0) AND ts <= to_timestamp($2/1000.0)
     GROUP BY host`,
    [startTime, endTime, label]
  )
  return toAggregatedData(r.rows)
}

export async function queryDevicesByHost(
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const pool = await getPool()
  if (!pool) return []
  const r = await pool.query<AggRow>(
    `SELECT source_ip AS label, sum(upload) AS upload, sum(download) AS download, count(*) AS count
     FROM data_usage_logs
     WHERE host = $3 AND ts >= to_timestamp($1/1000.0) AND ts <= to_timestamp($2/1000.0)
     GROUP BY source_ip`,
    [startTime, endTime, host]
  )
  return toAggregatedData(r.rows)
}

export async function queryProxyStatsByHost(
  dimension: DataUsageType,
  parentLabel: string,
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const pool = await getPool()
  if (!pool) return []
  const col = DIMENSION_COLUMNS[dimension]
  const r = await pool.query<AggRow>(
    `SELECT outbound AS label, sum(upload) AS upload, sum(download) AS download, count(*) AS count
     FROM data_usage_logs
     WHERE host = $3 AND ${col} = $4
       AND ts >= to_timestamp($1/1000.0) AND ts <= to_timestamp($2/1000.0)
     GROUP BY outbound`,
    [startTime, endTime, host, parentLabel]
  )
  return toAggregatedData(r.rows)
}

export async function getDataUsageRowCount(): Promise<number> {
  const pool = await getPool()
  if (!pool) return 0
  const r = await pool.query<{ count: string }>('SELECT count(*) AS count FROM data_usage_logs')
  return Number(r.rows[0]?.count ?? 0)
}

export type { TrafficLogRow }
