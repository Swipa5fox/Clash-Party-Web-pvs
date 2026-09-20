import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { openDb } from './db.mjs'
import { createCodeStore } from './codes.mjs'
import { createNonceStore } from './nonces.mjs'
import { enroll, challenge, config, revoke } from './gateway.mjs'

const CLASH = 'proxies:\n  - {name: a, type: ss}\n'
const REDIRECT = 'http://127.0.0.1:51000/callback'
const CLIENT = 'mihomo-party'

function mockRes() {
  const r = { status: 0, headers: {}, body: '' }
  r.writeHead = (s, h) => ((r.status = s), (r.headers = h || {}), r)
  r.end = (b) => ((r.body = b ?? ''), undefined)
  return r
}
function jsonOf(res) {
  return JSON.parse(res.body)
}
function newDevice() {
  return { deviceId: randomUUID() }
}
function setup({ retired = false, fetchSubscription } = {}) {
  const db = openDb(':memory:')
  db.addUser({ username: 'alice', pwdHash: 'scrypt$x', subUrl: 'https://o/sub', deviceLimit: 2 })
  return {
    db,
    codes: createCodeStore(),
    nonces: createNonceStore(),
    config: { retired, subTimeoutMs: 5000, subMaxBytes: 1024 },
    fetchSubscription: fetchSubscription ?? (async () => CLASH)
  }
}
function mintCode(deps, over = {}) {
  const verifier = 'verifier-' + 'a'.repeat(40)
  const code_challenge = createHash('sha256').update(verifier).digest('base64url')
  const code = deps.codes.issue({
    username: 'alice',
    redirect_uri: REDIRECT,
    client_id: CLIENT,
    code_challenge,
    ...over
  })
  return { code, verifier }
}
// Bind a device the quick way (skip the enroll dance) for challenge/config/revoke tests.
function bind(deps) {
  const dev = newDevice()
  deps.db.upsertDevice({ deviceId: dev.deviceId, username: 'alice' })
  return dev
}
function nonceBody(deps, dev) {
  const res = mockRes()
  challenge({ deviceId: dev.deviceId }, res, deps)
  const ch = jsonOf(res)
  return { deviceId: dev.deviceId, nonceId: ch.nonceId, nonce: ch.nonce }
}

// ---------- enroll ----------
test('enroll: valid request binds the device and returns ok (no pubkey)', () => {
  const deps = setup()
  const { code, verifier } = mintCode(deps)
  const dev = newDevice()
  const res = mockRes()
  enroll(
    {
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: dev.deviceId
    },
    res,
    deps
  )
  assert.equal(res.status, 200)
  assert.deepEqual(jsonOf(res), { ok: true })
  assert.equal(deps.db.getDevice(dev.deviceId).deviceId, dev.deviceId)
})

test('enroll: invalid/expired code → 400 invalid_code', () => {
  const deps = setup()
  const dev = newDevice()
  const res = mockRes()
  enroll(
    {
      code: 'nope',
      code_verifier: 'v',
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: dev.deviceId
    },
    res,
    deps
  )
  assert.equal(res.status, 400)
  assert.equal(jsonOf(res).error, 'invalid_code')
})

test('enroll: PKCE mismatch → 400 bad_pkce', () => {
  const deps = setup()
  const { code } = mintCode(deps)
  const dev = newDevice()
  const res = mockRes()
  enroll(
    {
      code,
      code_verifier: 'WRONG',
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: dev.deviceId
    },
    res,
    deps
  )
  assert.equal(res.status, 400)
  assert.equal(jsonOf(res).error, 'bad_pkce')
})

test('enroll: redirect_uri/client_id binding mismatch → 400 binding_mismatch', () => {
  const deps = setup()
  const { code, verifier } = mintCode(deps)
  const dev = newDevice()
  const res = mockRes()
  enroll(
    {
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:9/callback',
      client_id: CLIENT,
      deviceId: dev.deviceId
    },
    res,
    deps
  )
  assert.equal(res.status, 400)
  assert.equal(jsonOf(res).error, 'binding_mismatch')
})

test('enroll: malformed deviceId → 400 bad_request', () => {
  const deps = setup()
  const a = mintCode(deps)
  const r1 = mockRes()
  enroll(
    {
      code: a.code,
      code_verifier: a.verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: 'not-a-uuid'
    },
    r1,
    deps
  )
  assert.equal(r1.status, 400)
})

test('enroll: device limit reached → 403, but re-enrolling the same deviceId is allowed', () => {
  const deps = setup() // limit 2
  bind(deps)
  bind(deps) // now at 2
  const over = mintCode(deps)
  const dev = newDevice()
  const res = mockRes()
  enroll(
    {
      code: over.code,
      code_verifier: over.verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: dev.deviceId
    },
    res,
    deps
  )
  assert.equal(res.status, 403)
  assert.equal(jsonOf(res).error, 'device_limit')

  // existing device re-enroll is fine even at the cap
  const existing = deps.db.listDevices('alice')[0].deviceId
  const c = mintCode(deps)
  const res2 = mockRes()
  enroll(
    {
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      deviceId: existing
    },
    res2,
    deps
  )
  assert.equal(res2.status, 200)
})

// ---------- challenge ----------
test('challenge: unknown device → 403 device_revoked', () => {
  const deps = setup()
  const res = mockRes()
  challenge({ deviceId: randomUUID() }, res, deps)
  assert.equal(res.status, 403)
  assert.equal(jsonOf(res).error, 'device_revoked')
})

test('challenge: known device → nonceId + 32-byte nonce', () => {
  const deps = setup()
  const dev = bind(deps)
  const res = mockRes()
  challenge({ deviceId: dev.deviceId }, res, deps)
  assert.equal(res.status, 200)
  const c = jsonOf(res)
  assert.equal(Buffer.from(c.nonce, 'base64').length, 32)
  assert.ok(c.nonceId.length > 0)
})

test('challenge: retired gateway → 410 gateway_retired', () => {
  const deps = setup({ retired: true })
  const dev = bind(deps)
  const res = mockRes()
  challenge({ deviceId: dev.deviceId }, res, deps)
  assert.equal(res.status, 410)
  assert.equal(jsonOf(res).error, 'gateway_retired')
})

// ---------- config ----------
test('config: nonce request returns the subscription yaml and consumes the nonce', async () => {
  const deps = setup()
  const dev = bind(deps)
  const body = nonceBody(deps, dev)
  const res = mockRes()
  await config(body, res, deps)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /yaml/)
  assert.equal(res.body, CLASH)
  // replay the same nonce → rejected
  const res2 = mockRes()
  await config(body, res2, deps)
  assert.equal(res2.status, 401)
  assert.equal(jsonOf(res2).error, 'bad_nonce')
})

test('config: wrong nonce → 401 bad_nonce', async () => {
  const deps = setup()
  const dev = bind(deps)
  const body = nonceBody(deps, dev)
  body.nonce = Buffer.alloc(32, 7).toString('base64')
  const res = mockRes()
  await config(body, res, deps)
  assert.equal(res.status, 401)
  assert.equal(jsonOf(res).error, 'bad_nonce')
})

test('config: unknown device → 403 device_revoked', async () => {
  const deps = setup()
  const res = mockRes()
  await config(
    {
      deviceId: randomUUID(),
      nonceId: 'x',
      nonce: Buffer.alloc(32).toString('base64')
    },
    res,
    deps
  )
  assert.equal(res.status, 403)
  assert.equal(jsonOf(res).error, 'device_revoked')
})

test('config: retired gateway → 410', async () => {
  const deps = setup({ retired: true })
  const res = mockRes()
  await config({ deviceId: randomUUID() }, res, deps)
  assert.equal(res.status, 410)
})

test('config: upstream fetch failure → 502 upstream', async () => {
  const deps = setup({
    fetchSubscription: async () => {
      throw new Error('boom')
    }
  })
  const dev = bind(deps)
  const body = nonceBody(deps, dev)
  const res = mockRes()
  await config(body, res, deps)
  assert.equal(res.status, 502)
  assert.equal(jsonOf(res).error, 'upstream')
})

// ---------- revoke ----------
test('revoke: nonce request unbinds the device', async () => {
  const deps = setup()
  const dev = bind(deps)
  const body = nonceBody(deps, dev)
  const res = mockRes()
  await revoke(body, res, deps)
  assert.equal(res.status, 200)
  assert.deepEqual(jsonOf(res), { ok: true })
  assert.equal(deps.db.getDevice(dev.deviceId), undefined)
})

test('revoke: already-removed device → 200 ok (idempotent)', async () => {
  const deps = setup()
  const res = mockRes()
  await revoke(
    {
      deviceId: randomUUID(),
      nonceId: 'x',
      nonce: Buffer.alloc(32).toString('base64')
    },
    res,
    deps
  )
  assert.equal(res.status, 200)
  assert.deepEqual(jsonOf(res), { ok: true })
})

test('revoke: wrong nonce on an existing device → 401 and device stays bound', async () => {
  const deps = setup()
  const dev = bind(deps)
  const body = nonceBody(deps, dev)
  body.nonce = Buffer.alloc(32, 9).toString('base64')
  const res = mockRes()
  await revoke(body, res, deps)
  assert.equal(res.status, 401)
  assert.equal(jsonOf(res).error, 'bad_nonce')
  assert.ok(deps.db.getDevice(dev.deviceId))
})
