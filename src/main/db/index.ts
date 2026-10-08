import { Pool } from 'pg'
import { createLogger } from '../utils/logger'

const dbLogger = createLogger('DB')

let pool: Pool | null = null
let initPromise: Promise<Pool | null> | null = null

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS data_usage_logs (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  source_ip text NOT NULL,
  host text NOT NULL,
  outbound text NOT NULL,
  process text NOT NULL,
  upload bigint NOT NULL,
  download bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS data_usage_logs_ts_idx ON data_usage_logs USING brin (ts);
`

export function isDbEnabled(): boolean {
  return !!process.env.CP_DATABASE_URL
}

// CP_DATABASE_URL 未设置时返回 null，所有调用方据此跳过，行为同无 PG 的从前。
export async function getPool(): Promise<Pool | null> {
  const url = process.env.CP_DATABASE_URL
  if (!url) return null
  if (pool) return pool
  if (!initPromise) {
    initPromise = (async () => {
      const created = new Pool({
        connectionString: url,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5000
      })
      created.on('error', (e) => dbLogger.warn('PG pool idle client error', e))
      await created.query(SCHEMA_SQL)
      pool = created
      dbLogger.info('PostgreSQL connected, schema ensured')
      return pool
    })().catch((e) => {
      dbLogger.warn('PostgreSQL init failed; traffic logging disabled', e)
      initPromise = null
      return null
    })
  }
  return initPromise
}
