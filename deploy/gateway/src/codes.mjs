// In-memory one-time authorization-code pool. Codes are short-lived (TTL <= 60s),
// consumed exactly once, and bound to the redirect_uri/client_id/code_challenge they
// were issued with. Not persisted: a restart simply invalidates in-flight logins.
import { randomBytes } from 'node:crypto'

export function createCodeStore({ ttlMs = 60000, now = Date.now } = {}) {
  const codes = new Map() // code -> { ...payload, exp }

  function issue(payload) {
    const code = randomBytes(32).toString('base64url')
    codes.set(code, { ...payload, exp: now() + ttlMs })
    return code
  }

  function consume(code) {
    const entry = codes.get(code)
    if (!entry) return undefined
    codes.delete(code) // one-time, even if expired
    if (now() > entry.exp) return undefined
    const { exp, ...payload } = entry
    void exp
    return payload
  }

  function sweep() {
    const t = now()
    for (const [code, entry] of codes) if (t > entry.exp) codes.delete(code)
  }

  return { issue, consume, sweep, size: () => codes.size }
}
