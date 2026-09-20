const ICON_MAX_LEN = 64 * 1024
const ICON_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/webp;base64,'
]

function fail(msg: string): never {
  throw new Error(`Invalid plugin descriptor: ${msg}`)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertOnlyKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`unexpected field "${k}" in ${where}`)
  }
}

function validateIcon(icon: unknown): void {
  if (icon === undefined) return
  if (typeof icon !== 'string') fail('provider.icon must be a string')
  if (icon.length > ICON_MAX_LEN) fail('provider.icon too large')
  if (!ICON_PREFIXES.some((p) => icon.startsWith(p))) {
    fail('provider.icon must be a small png/jpeg/webp data uri (no svg, no external url)')
  }
}

// 本改造版允许 http 与任意 host（含内网 IP/localhost），以支持内网 IP 直连部署。
function assertHttpUrl(v: unknown, where: string): URL {
  if (typeof v !== 'string') fail(`${where} must be a string`)
  let u: URL
  try {
    u = new URL(v)
  } catch {
    fail(`${where} must be a valid URL`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(`${where} must be http(s)`)
  if (u.username || u.password) fail(`${where} must not contain userinfo`)
  return u
}

export function parseDescriptor(jsonText: string): IPluginDescriptor {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    fail('not valid JSON')
  }
  if (!isObject(raw)) fail('must be an object')
  if (raw.magic !== 'CPXF') fail('magic must be "CPXF"')
  if (raw.v === 1) {
    throw new Error(
      'Plugin file format is outdated (v1); please obtain the new file from your provider'
    )
  }
  if (raw.v !== 2) fail('v must be 2')
  if (raw.spec !== 'cpx-plugin/2') fail('spec must be "cpx-plugin/2"')
  assertOnlyKeys(raw, ['magic', 'v', 'spec', 'loginUrl', 'provider'], 'descriptor')

  const loginUrl = assertHttpUrl(raw.loginUrl, 'loginUrl')
  if (loginUrl.search || loginUrl.hash) fail('loginUrl must not contain query or fragment')

  if (!isObject(raw.provider)) fail('provider must be an object')
  assertOnlyKeys(raw.provider, ['name', 'icon', 'site'], 'provider')
  if (typeof raw.provider.name !== 'string' || raw.provider.name.length === 0) {
    fail('provider.name required')
  }
  validateIcon(raw.provider.icon)
  if (raw.provider.site !== undefined) assertHttpUrl(raw.provider.site, 'provider.site')

  return raw as unknown as IPluginDescriptor
}
