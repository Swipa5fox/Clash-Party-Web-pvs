import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNonceStore } from './nonces.mjs'

test('issue returns an ascii nonceId and a 32-byte standard-base64 nonce', () => {
  const store = createNonceStore()
  const c = store.issue('dev-1')
  assert.match(c.nonceId, /^[\x21-\x7e]{1,64}$/)
  assert.equal(Buffer.from(c.nonce, 'base64').length, 32)
  assert.equal(typeof c.exp, 'number')
})

test('check passes for a freshly issued nonce and fails after consume (one-time)', () => {
  const store = createNonceStore()
  const c = store.issue('dev-1')
  assert.equal(store.check('dev-1', c.nonceId, c.nonce), true)
  store.consume(c.nonceId)
  assert.equal(store.check('dev-1', c.nonceId, c.nonce), false)
})

test('check fails on wrong device, wrong nonce, or unknown nonceId', () => {
  const store = createNonceStore()
  const c = store.issue('dev-1')
  assert.equal(store.check('dev-2', c.nonceId, c.nonce), false)
  assert.equal(store.check('dev-1', c.nonceId, Buffer.alloc(32, 9).toString('base64')), false)
  assert.equal(store.check('dev-1', 'unknown', c.nonce), false)
})

test('an expired nonce does not pass check', () => {
  let clock = 1000
  const store = createNonceStore({ ttlMs: 60000, now: () => clock })
  const c = store.issue('dev-1')
  clock += 60001
  assert.equal(store.check('dev-1', c.nonceId, c.nonce), false)
})

test('per-device pool cap: issue beyond poolMax returns null until one is freed', () => {
  const store = createNonceStore({ poolMax: 2 })
  const a = store.issue('dev-1')
  store.issue('dev-1')
  assert.equal(store.issue('dev-1'), null) // pool full
  assert.notEqual(store.issue('dev-2'), null) // other device unaffected
  store.consume(a.nonceId)
  assert.notEqual(store.issue('dev-1'), null) // freed a slot
})

test('expired pending nonces do not count toward the pool cap', () => {
  let clock = 1000
  const store = createNonceStore({ ttlMs: 60000, poolMax: 1, now: () => clock })
  store.issue('dev-1')
  assert.equal(store.issue('dev-1'), null)
  clock += 60001
  assert.notEqual(store.issue('dev-1'), null)
})

test('consume of an unknown nonceId is a safe no-op', () => {
  const store = createNonceStore()
  assert.doesNotThrow(() => store.consume('nope'))
})
