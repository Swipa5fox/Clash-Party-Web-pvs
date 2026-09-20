// Load configuration from an environment object (injectable for tests). Pure: no I/O.
// The origin CA file, if configured, is read separately by server.mjs.
// LAN direct-access build: PUBLIC_ORIGIN is required — there is no domain fallback.
export function loadConfig(env = process.env) {
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  return Object.freeze({
    port: num(env.PORT, 8080),
    dbPath: env.DB_PATH || '/data/gateway.db',
    publicOrigin: env.PUBLIC_ORIGIN || '',
    deviceLimitDefault: num(env.DEVICE_LIMIT_DEFAULT, 3),
    codeTtlMs: num(env.CODE_TTL_MS, 60000),
    nonceTtlMs: num(env.NONCE_TTL_MS, 60000),
    noncePoolMax: num(env.NONCE_POOL_MAX, 8),
    loginMax: num(env.LOGIN_MAX, 10),
    loginWindowMs: num(env.LOGIN_WINDOW_MS, 60000),
    subTimeoutMs: num(env.SUB_TIMEOUT_MS, 30000),
    subMaxBytes: num(env.SUB_MAX_BYTES, 10 * 1024 * 1024),
    retired: env.RETIRED === 'true',
    originCaFile: env.ORIGIN_CA_FILE || '',
    // mihomo external-controller, reached over the compose network and proxied
    // through this gateway (single published web port). Set to '' to disable proxying.
    mihomoApiUrl: env.MIHOMO_API_URL ?? 'http://mihomo:9090',
    mihomoApiSecret: env.MIHOMO_API_SECRET || ''
  })
}
