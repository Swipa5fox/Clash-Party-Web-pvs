// The fixed gateway protocol: enroll / challenge / config / revoke. Mirrors the client
// v2 design §14. Handlers take (body, res, deps); deps = { db, codes, nonces, config,
// fetchSubscription }. Errors are JSON { error } with the status codes the client maps.
// LAN direct-access build: no request signing — the one-time nonce is the freshness proof.
import { verifyPkce } from './crypto.mjs'
import { sendJson, sendText } from './http.mjs'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function enroll(body, res, deps) {
  const bound = deps.codes.consume(body?.code) // one-time, even on later failure
  if (!bound) return sendJson(res, 400, { error: 'invalid_code' })
  if (!verifyPkce(body.code_verifier, bound.code_challenge)) {
    return sendJson(res, 400, { error: 'bad_pkce' })
  }
  if (body.redirect_uri !== bound.redirect_uri || body.client_id !== bound.client_id) {
    return sendJson(res, 400, { error: 'binding_mismatch' })
  }
  if (typeof body.deviceId !== 'string' || !UUID_V4.test(body.deviceId)) {
    return sendJson(res, 400, { error: 'bad_request' })
  }
  const user = deps.db.getUser(bound.username)
  if (!user) return sendJson(res, 400, { error: 'invalid_code' })

  const existing = deps.db.getDevice(body.deviceId)
  const isRebind = existing && existing.username === bound.username
  if (!isRebind && deps.db.countDevices(bound.username) >= user.deviceLimit) {
    return sendJson(res, 403, { error: 'device_limit' })
  }
  deps.db.upsertDevice({ deviceId: body.deviceId, username: bound.username })
  sendJson(res, 200, { ok: true })
}

export function challenge(body, res, deps) {
  if (deps.config.retired) return sendJson(res, 410, { error: 'gateway_retired' })
  const device = deps.db.getDevice(body?.deviceId)
  if (!device) return sendJson(res, 403, { error: 'device_revoked' })
  const issued = deps.nonces.issue(device.deviceId)
  if (!issued) return sendJson(res, 429, { error: 'too_many_nonces' })
  sendJson(res, 200, issued)
}

// Validate a nonce-protected request against an already-resolved device. Returns null
// on success (and consumes the nonce), else { status, error }. Caller verifies the
// device exists first. No signature — the nonce itself is the one-time freshness proof.
function verifyNonceRequest(body, deps) {
  if (!deps.nonces.check(body?.deviceId, body?.nonceId, body?.nonce)) {
    return { status: 401, error: 'bad_nonce' }
  }
  deps.nonces.consume(body.nonceId)
  return null
}

export async function config(body, res, deps) {
  if (deps.config.retired) return sendJson(res, 410, { error: 'gateway_retired' })
  const device = deps.db.getDevice(body?.deviceId)
  if (!device) return sendJson(res, 403, { error: 'device_revoked' })
  const bad = verifyNonceRequest(body, deps)
  if (bad) return sendJson(res, bad.status, { error: bad.error })

  const user = deps.db.getUser(device.username)
  try {
    const yaml = await deps.fetchSubscription(user.subUrl, {
      timeoutMs: deps.config.subTimeoutMs,
      maxBytes: deps.config.subMaxBytes,
      ca: deps.config.originCa
    })
    sendText(res, 200, yaml, 'text/yaml; charset=utf-8')
  } catch {
    sendJson(res, 502, { error: 'upstream' })
  }
}

export async function revoke(body, res, deps) {
  const device = deps.db.getDevice(body?.deviceId)
  if (!device) return sendJson(res, 200, { ok: true }) // idempotent: nothing to unbind
  const bad = verifyNonceRequest(body, deps)
  if (bad) return sendJson(res, bad.status, { error: bad.error })
  deps.db.delDevice(device.deviceId)
  sendJson(res, 200, { ok: true })
}
