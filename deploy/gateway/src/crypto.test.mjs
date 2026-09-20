import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hashPassword, verifyPassword, verifyPkce } from './crypto.mjs'

test('hashPassword/verifyPassword round-trips and rejects wrong password', () => {
  const stored = hashPassword('s3cret-pw')
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.equal(verifyPassword('s3cret-pw', stored), true)
  assert.equal(verifyPassword('wrong', stored), false)
})

test('verifyPassword returns false on a malformed stored hash', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false)
  assert.equal(verifyPassword('x', ''), false)
})

test('verifyPkce accepts BASE64URL(SHA256(verifier)) and rejects mismatch', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  assert.equal(verifyPkce(verifier, challenge), true)
  assert.equal(verifyPkce(verifier, challenge + 'x'), false)
  assert.equal(verifyPkce('different', challenge), false)
})
