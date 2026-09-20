import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.mjs'

test('applies sane defaults for an empty environment', () => {
  const c = loadConfig({})
  assert.equal(c.port, 8080)
  assert.equal(c.dbPath, '/data/gateway.db')
  assert.equal(c.deviceLimitDefault, 3)
  assert.equal(c.codeTtlMs, 60000)
  assert.equal(c.nonceTtlMs, 60000)
  assert.equal(c.noncePoolMax, 8)
  assert.equal(c.subMaxBytes, 10485760)
  assert.equal(c.retired, false)
})

test('parses numeric overrides as numbers', () => {
  const c = loadConfig({ PORT: '9000', NONCE_POOL_MAX: '4' })
  assert.strictEqual(c.port, 9000)
  assert.strictEqual(c.noncePoolMax, 4)
})

test('RETIRED is true only for the literal "true"', () => {
  assert.equal(loadConfig({ RETIRED: 'true' }).retired, true)
  assert.equal(loadConfig({ RETIRED: 'false' }).retired, false)
  assert.equal(loadConfig({ RETIRED: '1' }).retired, false)
})

test('publicOrigin is empty when PUBLIC_ORIGIN is unset (no domain fallback)', () => {
  assert.equal(loadConfig({}).publicOrigin, '')
  assert.equal(loadConfig({ DOMAIN: 'gw.example.com' }).publicOrigin, '')
  assert.equal(
    loadConfig({ PUBLIC_ORIGIN: 'http://192.168.1.100:8080' }).publicOrigin,
    'http://192.168.1.100:8080'
  )
})

test('the returned config object is frozen', () => {
  const c = loadConfig({})
  assert.throws(() => {
    c.port = 1
  })
})
