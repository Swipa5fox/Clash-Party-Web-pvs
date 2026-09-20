import type { LookupFunction } from 'net'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'
import { requestOnce } from './http-client'

const MAX_BYTES = 64 * 1024

export interface DiscoverOpts {
  timeout: number
  lookup?: LookupFunction
  proxy?: { host: string; port: number }
}

function fail(msg: string): never {
  throw new Error(`Invalid gateway discovery: ${msg}`)
}

function assertOrigin(v: unknown, where: string): string {
  const origin = parseGatewayOrigin(v)
  if (!origin) fail(`${where} must be an http(s) origin with no path/query/fragment/userinfo`)
  return origin
}

function assertRelPath(v: unknown, where: string): string {
  if (!isValidEndpointPath(v)) {
    fail(`${where} must be a relative path starting with "/" (no scheme/host/query/fragment)`)
  }
  return v
}

export async function discoverGateway(
  loginUrl: string,
  opts: DiscoverOpts
): Promise<IGatewayWellKnown> {
  // 沿用 loginUrl 的协议（http 或 https），支持内网 IP 纯 HTTP 直连部署。
  const u = new URL(loginUrl)
  const url = `${u.protocol}//${u.host}/.well-known/cpx-gateway`
  const lookup = opts.lookup
  const res = await requestOnce(url, {
    method: 'GET',
    timeout: opts.timeout,
    maxBytes: MAX_BYTES,
    lookup,
    proxy: opts.proxy
  })
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Discovery failed: status ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(res.body)
  } catch {
    fail('not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null) fail('must be an object')
  const obj = raw as Record<string, unknown>
  if (obj.spec !== 'cpx-plugin/2') fail('spec must be "cpx-plugin/2"')
  const gateway = assertOrigin(obj.gateway, 'gateway')
  if (typeof obj.endpoints !== 'object' || obj.endpoints === null) fail('endpoints required')
  const e = obj.endpoints as Record<string, unknown>
  return {
    spec: 'cpx-plugin/2',
    gateway,
    endpoints: {
      enroll: assertRelPath(e.enroll, 'endpoints.enroll'),
      challenge: assertRelPath(e.challenge, 'endpoints.challenge'),
      config: assertRelPath(e.config, 'endpoints.config'),
      revoke: assertRelPath(e.revoke, 'endpoints.revoke')
    }
  }
}
