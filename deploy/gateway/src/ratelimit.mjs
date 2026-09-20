// Fixed-window in-memory rate limiter. hit(key) returns true if allowed, false if over
// the cap for the current window. Good enough for one-instance login throttling.
export function createRateLimiter({ max = 10, windowMs = 60000, now = Date.now } = {}) {
  const windows = new Map() // key -> { count, resetAt }

  function hit(key) {
    const t = now()
    let w = windows.get(key)
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + windowMs }
      windows.set(key, w)
    }
    w.count++
    return w.count <= max
  }

  function sweep() {
    const t = now()
    for (const [k, w] of windows) if (t >= w.resetAt) windows.delete(k)
  }

  return { hit, sweep }
}
