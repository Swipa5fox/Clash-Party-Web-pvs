import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCodeStore } from './codes.mjs'

const payload = {
  username: 'alice',
  redirect_uri: 'http://127.0.0.1:5000/callback',
  client_id: 'mihomo-party',
  code_challenge: 'abc'
}

test('issue returns a high-entropy base64url code', () => {
  const store = createCodeStore()
  const code = store.issue(payload)
  assert.match(code, /^[A-Za-z0-9_-]{40,}$/)
})

test('consume returns the payload exactly once (one-time)', () => {
  const store = createCodeStore()
  const code = store.issue(payload)
  assert.deepEqual(store.consume(code), payload)
  assert.equal(store.consume(code), undefined)
})

test('consume of an unknown code returns undefined', () => {
  const store = createCodeStore()
  assert.equal(store.consume('nope'), undefined)
})

test('an expired code is not consumable', () => {
  let clock = 1000
  const store = createCodeStore({ ttlMs: 60000, now: () => clock })
  const code = store.issue(payload)
  clock += 60001
  assert.equal(store.consume(code), undefined)
})

test('a code just inside the TTL is still consumable', () => {
  let clock = 1000
  const store = createCodeStore({ ttlMs: 60000, now: () => clock })
  const code = store.issue(payload)
  clock += 59999
  assert.deepEqual(store.consume(code), payload)
})

test('two issued codes are distinct', () => {
  const store = createCodeStore()
  assert.notEqual(store.issue(payload), store.issue(payload))
})
