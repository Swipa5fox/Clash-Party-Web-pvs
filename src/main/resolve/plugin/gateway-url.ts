// 网关 origin / 端点 path 的字面校验（无 DNS、无网络）。discovery（解析 .well-known）与
// vault（解密缓存的网关）共用，避免两处校验语义分叉。

// 校验并归一化网关 origin：必须 http(s)、无 userinfo、无 path/query/fragment。
// 本改造版允许 http 与任意 host（含内网 IP/localhost），以支持内网 IP 直连部署。
// 合法返回 origin 字符串（scheme + host[+port]），非法返回 null。
export function parseGatewayOrigin(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  if (u.search || u.hash || (u.pathname && u.pathname !== '/')) return null
  return u.origin
}

// 端点必须是以 '/' 开头的相对 path：不得为协议相对（//host）、不得含 scheme/host/query/fragment，
// 也不得含反斜杠 —— WHATWG URL 在 http(s) 下把 '\' 当作 '/'，故 '/\evil/x' 会逃逸到另一个 host。
export function isValidEndpointPath(v: unknown): v is string {
  if (typeof v !== 'string' || !v.startsWith('/')) return false
  if (
    v.startsWith('//') ||
    v.includes('\\') ||
    v.includes('?') ||
    v.includes('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(v)
  ) {
    return false
  }
  return true
}
