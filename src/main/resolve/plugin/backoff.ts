const FIVE_MIN = 5 * 60 * 1000
const ONE_DAY = 24 * 60 * 60 * 1000

export interface BackoffResult {
  failureCount: number
  nextRetryAt: number
}

export function computeBackoff(
  failureCount: number,
  now: number,
  rand: () => number = Math.random
): BackoffResult {
  const base = Math.min(FIVE_MIN * 2 ** failureCount, ONE_DAY)
  const jitter = base * 0.3 * rand()
  return { failureCount, nextRetryAt: now + base + jitter }
}
