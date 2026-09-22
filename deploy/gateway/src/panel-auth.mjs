// Cookie gate for the mihomo control API that the gateway republishes on its single
// web port (:8080). The panel is a same-origin browser SPA, so it cannot attach an
// Authorization header — a session cookie is the only credential that rides along with
// both its REST calls and its WebSocket streams without panel-side changes.
//
// Sessions are stateless: the cookie is `expiry.HMAC(key, expiry)`, so an expired or
// forged value is rejected without any server-side store to grow unbounded.
//
// Empty token => gate disabled, i.e. the pre-hardening open-proxy behaviour. Deploy
// tooling generates a token on first run; set PANEL_TOKEN= explicitly to opt out.
import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'cpx_panel'
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000

// Minimal Cookie header parser: name=value pairs, ';' separated.
export function parseCookies(header) {
  const out = {}
  if (typeof header !== 'string' || !header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      out[name] = part.slice(eq + 1).trim()
    }
  }
  return out
}

// Constant-time compare of two strings without leaking either length (both are
// collapsed to a fixed-width digest first).
function digest(key, value) {
  return createHmac('sha256', key).update(String(value)).digest()
}

function safeEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createPanelGate({ token = '', ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const enabled = typeof token === 'string' && token.length > 0
  const key = enabled ? token : 'disabled'

  function sign(expiry) {
    return digest(key, expiry).toString('base64url')
  }

  // A valid session cookie, minted from the configured token.
  function sessionValue() {
    const expiry = now() + ttlMs
    return `${expiry}.${sign(expiry)}`
  }

  function validSession(value) {
    if (!enabled || typeof value !== 'string') return false
    const dot = value.lastIndexOf('.')
    if (dot < 1) return false
    const expiry = value.slice(0, dot)
    const mac = value.slice(dot + 1)
    if (!/^\d+$/.test(expiry)) return false
    if (Number(expiry) <= now()) return false
    return safeEqual(digest(key, expiry), Buffer.from(mac, 'base64url'))
  }

  function isAuthed(req) {
    return validSession(parseCookies(req.headers?.cookie)[COOKIE_NAME])
  }

  // Accept the gate cookie only from the browser itself: HttpOnly keeps it out of
  // panel scripts, SameSite=Lax stops a cross-site form POST from carrying it (which
  // is also the CSRF defence for PUT /configs and friends). No `Secure` — this build
  // is plain HTTP on a trusted LAN by design.
  function cookieHeaders() {
    return {
      set: `${COOKIE_NAME}=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax`,
      clear: `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  }

  // Compare a submitted token against the configured one in constant time.
  function checkToken(candidate) {
    if (!enabled) return false
    return safeEqual(digest(key, candidate ?? ''), digest(key, token))
  }

  function loginPage({ error = '', already = false } = {}) {
    return `<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>控制面板 / Control Panel</title>
<body style="font:16px/1.6 system-ui,sans-serif;background:#f6f7f9;margin:0">
<div style="max-width:26rem;margin:14vh auto;padding:0 1.2rem">
  <h2 style="margin:.2rem 0 1rem">控制面板访问验证 / Panel access</h2>
  ${
    already
      ? '<p style="color:#666">此浏览器已验证，正在跳转 / Already signed in, redirecting…</p>'
      : ''
  }
  ${error ? `<p style="color:#c00">${error}</p>` : ''}
  <form method="post" action="/panel/login">
    <p><label>访问令牌 / Access token<br>
      <input name="token" type="password" autocomplete="off" style="width:100%;padding:.5rem">
    </label></p>
    <p><button type="submit" style="padding:.5rem 1.2rem">进入 / Enter</button></p>
  </form>
  <p style="color:#666;font-size:.85rem">
    令牌即 <code>.env</code> 里的 PANEL_TOKEN（首次部署时与 CP_WEB_TOKEN 同值）。<br>
    The token is <code>PANEL_TOKEN</code> in <code>.env</code> — on a fresh deploy it
    is generated with the same value as <code>CP_WEB_TOKEN</code>.
  </p>
</div></body></html>`
  }

  return { enabled, cookieName: COOKIE_NAME, cookieHeaders, isAuthed, checkToken, loginPage }
}
