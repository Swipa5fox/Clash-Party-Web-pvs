import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.mjs'
import { createCodeStore } from './codes.mjs'
import { createRateLimiter } from './ratelimit.mjs'
import { hashPassword } from './crypto.mjs'
import { authorizeGet, authorizePost } from './auth.mjs'

const PARAMS = {
  response_type: 'code',
  client_id: 'mihomo-party',
  redirect_uri: 'http://127.0.0.1:51000/callback',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'st-123',
  scope: 'subscribe'
}

function deps() {
  const db = openDb(':memory:')
  db.addUser({
    username: 'alice',
    pwdHash: hashPassword('pw'),
    subUrl: 'https://o/sub',
    deviceLimit: 3
  })
  return {
    db,
    codes: createCodeStore(),
    rateLimiter: createRateLimiter({ max: 5, windowMs: 1000 })
  }
}

function mockRes() {
  const r = { status: 0, headers: {}, body: '' }
  r.writeHead = (s, h) => ((r.status = s), (r.headers = h || {}), r)
  r.end = (b) => ((r.body = b ?? ''), undefined)
  return r
}

test('authorizeGet renders a self-contained login form with the OAuth params', () => {
  const res = mockRes()
  authorizeGet(PARAMS, res)
  assert.equal(res.status, 200)
  assert.match(res.body, /<form[^>]*method="post"/i)
  assert.match(res.body, /name="state"[^>]*value="st-123"/)
  assert.match(res.body, /name="code_challenge"/)
  assert.doesNotMatch(res.body, /<script/i) // no inline/external script
})

test('authorizeGet rejects a non-loopback redirect_uri', () => {
  const res = mockRes()
  authorizeGet({ ...PARAMS, redirect_uri: 'https://evil.example/callback' }, res)
  assert.equal(res.status, 400)
})

test('authorizeGet rejects a non-S256 challenge method', () => {
  const res = mockRes()
  authorizeGet({ ...PARAMS, code_challenge_method: 'plain' }, res)
  assert.equal(res.status, 400)
})

test('authorizePost with valid creds issues a bound code and redirects with state', () => {
  const d = deps()
  const res = mockRes()
  authorizePost({ ...PARAMS, username: 'alice', password: 'pw' }, '1.2.3.4', res, d)
  assert.equal(res.status, 302)
  const loc = new URL(res.headers.location)
  assert.equal(loc.origin + loc.pathname, 'http://127.0.0.1:51000/callback')
  assert.equal(loc.searchParams.get('state'), 'st-123')
  const code = loc.searchParams.get('code')
  const bound = d.codes.consume(code)
  assert.deepEqual(bound, {
    username: 'alice',
    redirect_uri: PARAMS.redirect_uri,
    client_id: 'mihomo-party',
    code_challenge: PARAMS.code_challenge
  })
})

test('authorizePost with a wrong password re-renders the form (200) and issues no code', () => {
  const d = deps()
  const res = mockRes()
  authorizePost({ ...PARAMS, username: 'alice', password: 'WRONG' }, '1.2.3.4', res, d)
  assert.equal(res.status, 200)
  assert.match(res.body, /<form/i)
  assert.equal(d.codes.size(), 0)
})

test('authorizePost with an unknown user issues no code', () => {
  const d = deps()
  const res = mockRes()
  authorizePost({ ...PARAMS, username: 'ghost', password: 'pw' }, '1.2.3.4', res, d)
  assert.equal(res.status, 200)
  assert.equal(d.codes.size(), 0)
})

test('authorizePost rate-limits repeated attempts from one IP', () => {
  const d = { ...deps(), rateLimiter: createRateLimiter({ max: 1, windowMs: 1000 }) }
  authorizePost({ ...PARAMS, username: 'alice', password: 'x' }, '9.9.9.9', mockRes(), d)
  const res = mockRes()
  authorizePost({ ...PARAMS, username: 'alice', password: 'x' }, '9.9.9.9', res, d)
  assert.equal(res.status, 429)
})

test('authorizePost escapes a malicious state when re-rendering (no reflected script)', () => {
  const d = deps()
  const res = mockRes()
  const evil = '"><script>alert(1)</script>'
  authorizePost({ ...PARAMS, state: evil, username: 'alice', password: 'WRONG' }, '1.2.3.4', res, d)
  assert.equal(res.status, 200)
  assert.doesNotMatch(res.body, /<script>alert/i)
})
