// In-memory per-device nonce pool for challenge-response. Each nonce is 32 random
// bytes with a short TTL (<= 60s), consumed exactly once. A per-device cap (default 8)
// blocks challenge spam. Not persisted — restart drops in-flight challenges.
import { randomBytes, timingSafeEqual } from 'node:crypto'

export function createNonceStore({ ttlMs = 60000, poolMax = 8, now = Date.now } = {}) {
  const pending = new Map() // nonceId -> { deviceId, nonce(b64), exp }

  function sweep() {
    const t = now()
    for (const [id, e] of pending) if (t > e.exp) pending.delete(id)
  }

  function countFor(deviceId) {
    const t = now()
    let n = 0
    for (const e of pending.values()) if (e.deviceId === deviceId && t <= e.exp) n++
    return n
  }

  function issue(deviceId) {
    sweep()
    if (countFor(deviceId) >= poolMax) return null
    const nonceId = randomBytes(16).toString('hex')
    const nonce = randomBytes(32).toString('base64')
    pending.set(nonceId, { deviceId, nonce, exp: now() + ttlMs })
    return { nonceId, nonce, exp: Math.floor(ttlMs / 1000) }
  }

  // Validate without consuming (caller verifies the signature, then consumes).
  function check(deviceId, nonceId, nonceB64) {
    const e = pending.get(nonceId)
    if (!e || e.deviceId !== deviceId || now() > e.exp) return false
    const a = Buffer.from(e.nonce, 'base64')
    const b = Buffer.from(String(nonceB64), 'base64')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  function consume(nonceId) {
    pending.delete(nonceId)
  }

  return { issue, check, consume, sweep, pending: (id) => countFor(id) }
}
