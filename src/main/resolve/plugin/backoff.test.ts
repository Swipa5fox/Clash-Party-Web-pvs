import { describe, it, expect } from 'vitest'
import { computeBackoff } from './backoff'

const FIVE_MIN = 5 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

describe('computeBackoff', () => {
  it('uses 5m * 2^failureCount with no jitter when rand=0', () => {
    expect(computeBackoff(0, 1000, () => 0).nextRetryAt).toBe(1000 + FIVE_MIN)
    expect(computeBackoff(2, 0, () => 0).nextRetryAt).toBe(FIVE_MIN * 4)
  })
  it('caps the base at 24h', () => {
    expect(computeBackoff(20, 0, () => 0).nextRetryAt).toBe(DAY)
  })
  it('adds up to 30% jitter when rand=1', () => {
    expect(computeBackoff(0, 0, () => 1).nextRetryAt).toBe(FIVE_MIN + FIVE_MIN * 0.3)
  })
})
