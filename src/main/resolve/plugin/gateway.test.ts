import { describe, it, expect, vi, beforeEach } from 'vitest'

const requestOnce = vi.fn()
vi.mock('./http-client', () => ({ requestOnce: (...a: unknown[]) => requestOnce(...a) }))

import { enroll, challenge, fetchConfig, revoke } from './gateway'

const TARGET = {
  gateway: 'https://gw.front.com',
  endpoints: { enroll: '/enroll', challenge: '/challenge', config: '/config', revoke: '/revoke' }
}
const NET = { timeout: 5000 }
const CLASH =
  'proxies:\n  - {name: a, type: ss, server: 1.1.1.1, port: 8388, cipher: aes-128-gcm, password: x}\n'

function jsonReply(body: unknown, status = 200): void {
  requestOnce.mockResolvedValueOnce({ status, headers: {}, body: JSON.stringify(body) })
}
function rawReply(body: string, status = 200): void {
  requestOnce.mockResolvedValueOnce({ status, headers: {}, body })
}
function lastBody(): any {
  const call = requestOnce.mock.calls[requestOnce.mock.calls.length - 1]
  return JSON.parse((call[1] as { body: string }).body)
}

beforeEach(() => requestOnce.mockReset())

describe('gateway.enroll', () => {
  it('posts code+verifier+redirect+client+deviceId (no pubkey), resolves on ok', async () => {
    jsonReply({ ok: true })
    await enroll(
      TARGET,
      {
        code: 'C',
        code_verifier: 'V',
        redirect_uri: 'http://127.0.0.1:5/callback',
        client_id: 'mihomo-party',
        deviceId: 'DID'
      },
      NET
    )
    expect(requestOnce).toHaveBeenCalledWith('https://gw.front.com/enroll', expect.any(Object))
    const body = lastBody()
    expect(body).toMatchObject({ code: 'C', code_verifier: 'V', deviceId: 'DID' })
    expect(body).not.toHaveProperty('devicePubKey')
  })
  it('maps explicit revoked to GatewayError(revoked)', async () => {
    jsonReply({ error: 'revoked' }, 403)
    await expect(enroll(TARGET, {} as never, NET)).rejects.toMatchObject({ kind: 'revoked' })
  })
})

describe('gateway.challenge', () => {
  it('returns nonceId/nonce/exp', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(32, 1).toString('base64'), exp: 60 })
    const c = await challenge(TARGET, 'DID', NET)
    expect(c.nonceId).toBe('N1')
    expect(Buffer.from(c.nonce, 'base64')).toHaveLength(32)
  })
  it('rejects a nonce that is not 32 bytes as transient', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(16, 1).toString('base64'), exp: 60 })
    await expect(challenge(TARGET, 'DID', NET)).rejects.toMatchObject({ kind: 'transient' })
  })
  it('rejects a non-base64 nonce as transient', async () => {
    jsonReply({ nonceId: 'N1', nonce: 'not base64 !!!', exp: 60 })
    await expect(challenge(TARGET, 'DID', NET)).rejects.toMatchObject({ kind: 'transient' })
  })
  it('rejects a nonceId with control/whitespace chars as transient', async () => {
    jsonReply({ nonceId: 'bad\nid', nonce: Buffer.alloc(32, 1).toString('base64'), exp: 60 })
    await expect(challenge(TARGET, 'DID', NET)).rejects.toMatchObject({ kind: 'transient' })
  })
})

describe('gateway.fetchConfig', () => {
  it('challenge→config posts the nonce back unsigned; returns YAML', async () => {
    const nonceB64 = Buffer.alloc(32, 9).toString('base64')
    jsonReply({ nonceId: 'N1', nonce: nonceB64, exp: 60 })
    rawReply(CLASH)
    const yaml = await fetchConfig(TARGET, { deviceId: 'DID' }, NET)
    expect(yaml).toBe(CLASH)
    const body = lastBody()
    expect(body).toMatchObject({ deviceId: 'DID', nonceId: 'N1', nonce: nonceB64 })
    expect(body).not.toHaveProperty('sig')
    expect(body).not.toHaveProperty('ts')
  })
  it('rejects a non-clash config body as transient', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(32).toString('base64'), exp: 60 })
    rawReply('just text')
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'transient'
    })
  })
  it('maps 410 to GatewayError(retired)', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(32).toString('base64'), exp: 60 })
    rawReply('', 410)
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'retired'
    })
  })
  it('maps gateway_retired json marker to retired', async () => {
    jsonReply({ error: 'gateway_retired' }, 200)
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'retired'
    })
  })
  it('maps 5xx to transient', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(32).toString('base64'), exp: 60 })
    rawReply('', 503)
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'transient'
    })
  })
  it('maps a DNS failure (ENOTFOUND) to unreachable', async () => {
    requestOnce.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND gw.front.com'), { code: 'ENOTFOUND' })
    )
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'unreachable'
    })
  })
  it('maps a connection refused (ECONNREFUSED) to unreachable', async () => {
    requestOnce.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'unreachable'
    })
  })
  it('maps a TLS failure code to unreachable', async () => {
    requestOnce.mockRejectedValueOnce(
      Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
    )
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'unreachable'
    })
  })
  it('maps a timeout/generic error (no network code) to transient', async () => {
    requestOnce.mockRejectedValueOnce(new Error('Request timed out'))
    await expect(fetchConfig(TARGET, { deviceId: 'DID' }, NET)).rejects.toMatchObject({
      kind: 'transient'
    })
  })
})

describe('gateway.revoke', () => {
  it('posts the nonce back unsigned; idempotent ok', async () => {
    jsonReply({ nonceId: 'N1', nonce: Buffer.alloc(32, 3).toString('base64'), exp: 60 })
    jsonReply({ ok: true })
    await revoke(TARGET, { deviceId: 'DID' }, NET)
    const body = lastBody()
    expect(body).toMatchObject({ deviceId: 'DID', nonceId: 'N1' })
    expect(body).not.toHaveProperty('sig')
  })
})

describe('gateway urlOf host-escape defense', () => {
  it('refuses an endpoint that escapes the gateway origin (backslash) before any request', async () => {
    const evil = {
      gateway: 'https://gw.front.com',
      endpoints: { enroll: '/e', challenge: '/\\evil.example/c', config: '/cfg', revoke: '/r' }
    }
    requestOnce.mockClear()
    await expect(challenge(evil, 'DID', NET)).rejects.toMatchObject({ kind: 'transient' })
    expect(requestOnce).not.toHaveBeenCalled()
  })
})
