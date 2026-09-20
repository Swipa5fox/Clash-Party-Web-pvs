// Crypto primitives for the gateway. Native node:crypto only — no dependencies.
// LAN direct-access build: no request signing — only password hashing and PKCE remain.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 32

// "scrypt$N$r$p$saltB64$hashB64" — self-describing so params can change without breaking old hashes.
export function hashPassword(plain) {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, n, r, p, saltB64, hashB64] = parts
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p)
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// PKCE S256: BASE64URL(SHA256(verifier)) === code_challenge (constant-time compare).
export function verifyPkce(verifier, challenge) {
  try {
    const computed = Buffer.from(createHash('sha256').update(String(verifier)).digest('base64url'))
    const given = Buffer.from(String(challenge))
    return computed.length === given.length && timingSafeEqual(computed, given)
  } catch {
    return false
  }
}
