import { describe, expect, it } from 'vitest'
import { normalizeMaxRows, normalizeRetentionDays } from './app'

describe('PG 日志设置归一', () => {
  it('retention days clamps to [1,365] with fallback 7', () => {
    expect(normalizeRetentionDays(14)).toBe(14)
    expect(normalizeRetentionDays(0)).toBe(1)
    expect(normalizeRetentionDays(99999)).toBe(365)
    expect(normalizeRetentionDays(undefined)).toBe(7)
    expect(normalizeRetentionDays('abc')).toBe(7)
  })

  it('max rows clamps to [1000,10_000_000] with fallback 500k', () => {
    expect(normalizeMaxRows(100000)).toBe(100000)
    expect(normalizeMaxRows(1)).toBe(1000)
    expect(normalizeMaxRows(Number.MAX_SAFE_INTEGER)).toBe(10_000_000)
    expect(normalizeMaxRows(undefined)).toBe(500000)
    expect(normalizeMaxRows('abc')).toBe(500000)
    expect(normalizeMaxRows(null)).toBe(1000)
  })
})
