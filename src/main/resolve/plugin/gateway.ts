import type { LookupFunction } from 'net'
import { parse } from '../../utils/yaml'
import { requestOnce } from './http-client'

const MAX_BYTES = 10 * 1024 * 1024

export interface GatewayNet {
  timeout: number
  lookup?: LookupFunction
  proxy?: { host: string; port: number }
}

export interface GatewayTarget {
  gateway: string
  endpoints: IGatewayEndpoints
}

export type GatewayErrorKind = 'revoked' | 'retired' | 'unreachable' | 'transient'

export class GatewayError extends Error {
  kind: GatewayErrorKind
  status?: number
  constructor(kind: GatewayErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'GatewayError'
    this.kind = kind
    this.status = status
  }
}

interface RawResult {
  status: number
  json: Record<string, unknown> | undefined
  text: string
}

function urlOf(t: GatewayTarget, ep: keyof IGatewayEndpoints): string {
  const u = new URL(t.endpoints[ep], t.gateway)
  // 第二道防线：拼出的 URL 必须仍落在网关 origin 上（防端点逃逸到其它 host，如反斜杠/编码技巧）。
  if (u.origin !== new URL(t.gateway).origin) {
    throw new GatewayError('transient', 'endpoint escaped gateway origin')
  }
  return u.toString()
}

// 本改造版不再默认注入 guarded lookup（SSRF 防护），以支持内网 IP 直连；调用方可通过 net.lookup 自定义。
function lookupFor(net: GatewayNet): LookupFunction | undefined {
  return net.lookup
}

// DNS 解析失败 / 连接拒绝 / TLS 失败 → 缓存网关“不可达/已退役”信号（spec §5），交由编排层重新发现。
// 超时（'Request timed out' / ETIMEDOUT）、5xx、429、SSRF/重定向/大小拦截仍按瞬时失败退避，不在此列。
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENETDOWN',
  'EPIPE',
  'EPROTO'
])

function isUnreachable(e: NodeJS.ErrnoException): boolean {
  const code = e.code ?? ''
  if (UNREACHABLE_CODES.has(code)) return true
  // Node 的 TLS/证书错误 code 形如 ERR_TLS_*, ERR_SSL_*, CERT_*, SELF_SIGNED_*, UNABLE_TO_*, DEPTH_ZERO_*
  return /^(ERR_TLS|ERR_SSL|CERT_|SELF_SIGNED_|UNABLE_TO_|DEPTH_ZERO_)/.test(code)
}

async function postJson(url: string, body: unknown, net: GatewayNet): Promise<RawResult> {
  let res: { status: number; body: string }
  try {
    res = await requestOnce(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: net.timeout,
      maxBytes: MAX_BYTES,
      lookup: lookupFor(net),
      proxy: net.proxy
    })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    throw new GatewayError(isUnreachable(err) ? 'unreachable' : 'transient', err.message)
  }
  let json: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(res.body)
    json =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined
  } catch {
    json = undefined
  }
  return { status: res.status, json, text: res.body }
}

function classify(r: RawResult): GatewayError | null {
  if (r.status === 410 || r.json?.error === 'gateway_retired') {
    return new GatewayError('retired', 'gateway retired', r.status)
  }
  if (r.json?.error === 'revoked' || r.json?.error === 'device_revoked') {
    return new GatewayError('revoked', 'device revoked', r.status)
  }
  if (r.status < 200 || r.status >= 300) {
    return new GatewayError('transient', `gateway status ${r.status}`, r.status)
  }
  return null
}

// 不透明 ASCII token（可见 ASCII，无空白/控制字符），长度 1..max
function isAsciiToken(s: string, max: number): boolean {
  return s.length > 0 && s.length <= max && /^[\x21-\x7e]+$/.test(s)
}

// 标准 base64（带 padding），且解码后恰为 n 字节、再编码可还原（拒非规范编码）
function isB64Bytes(s: string, n: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false
  const buf = Buffer.from(s, 'base64')
  return buf.length === n && buf.toString('base64') === s
}

function isClashConfig(yamlText: string): boolean {
  let parsed: unknown
  try {
    parsed = parse(yamlText)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const obj = parsed as Record<string, unknown>
  return Boolean(obj['proxies'] || obj['proxy-providers'])
}

export interface EnrollBody {
  code: string
  code_verifier: string
  redirect_uri: string
  client_id: string
  deviceId: string
}

export async function enroll(t: GatewayTarget, body: EnrollBody, net: GatewayNet): Promise<void> {
  const r = await postJson(urlOf(t, 'enroll'), body, net)
  const err = classify(r)
  if (err) throw err
}

export async function challenge(
  t: GatewayTarget,
  deviceId: string,
  net: GatewayNet
): Promise<{ nonceId: string; nonce: string; exp: number }> {
  const r = await postJson(urlOf(t, 'challenge'), { deviceId }, net)
  const err = classify(r)
  if (err) throw err
  const j = r.json
  // 结构校验（spec §7）：nonceId 为不透明 ASCII ≤64；nonce 必须是 32 raw bytes 的标准 base64。
  // 坏数据按瞬时失败处理，避免畸形 nonce 进入签名串。
  if (
    !j ||
    typeof j.nonceId !== 'string' ||
    typeof j.nonce !== 'string' ||
    !isAsciiToken(j.nonceId, 64) ||
    !isB64Bytes(j.nonce, 32)
  ) {
    throw new GatewayError('transient', 'bad challenge response', r.status)
  }
  return { nonceId: j.nonceId, nonce: j.nonce, exp: Number(j.exp) || 0 }
}

interface DeviceCred {
  deviceId: string
}

// LAN direct-access build: no request signing — the one-time nonce from
// /challenge is replayed back to prove freshness (anti-replay token).
async function noncePost(
  t: GatewayTarget,
  ep: 'config' | 'revoke',
  dev: DeviceCred,
  net: GatewayNet
): Promise<RawResult> {
  const ch = await challenge(t, dev.deviceId, net)
  return postJson(
    urlOf(t, ep),
    { deviceId: dev.deviceId, nonceId: ch.nonceId, nonce: ch.nonce },
    net
  )
}

export async function fetchConfig(
  t: GatewayTarget,
  dev: DeviceCred,
  net: GatewayNet
): Promise<string> {
  const r = await noncePost(t, 'config', dev, net)
  const err = classify(r)
  if (err) throw err
  if (!isClashConfig(r.text)) {
    throw new GatewayError('transient', 'subscription is not a valid clash config', r.status)
  }
  return r.text
}

export async function revoke(t: GatewayTarget, dev: DeviceCred, net: GatewayNet): Promise<void> {
  const r = await noncePost(t, 'revoke', dev, net)
  const err = classify(r)
  if (err) throw err
}
