import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from './ratelimit.mjs'

test('allows up to max hits then blocks within the window', () => {
  let clock = 0
  const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => clock })
  assert.equal(rl.hit('ip'), true)
  assert.equal(rl.hit('ip'), true)
  assert.equal(rl.hit('ip'), true)
  assert.equal(rl.hit('ip'), false) // 4th in window
})

test('resets after the window elapses', () => {
  let clock = 0
  const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => clock })
  assert.equal(rl.hit('ip'), true)
  assert.equal(rl.hit('ip'), false)
  clock += 1001
  assert.equal(rl.hit('ip'), true)
})

test('tracks keys independently', () => {
  const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 })
  assert.equal(rl.hit('a'), true)
  assert.equal(rl.hit('b'), true)
  assert.equal(rl.hit('a'), false)
})
