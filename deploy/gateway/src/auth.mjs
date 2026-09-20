// OAuth 2.0 authorize endpoint (the public login page). Renders a self-contained
// login form, validates credentials against the local account store, and issues a
// one-time authorization code bound to the PKCE challenge + loopback redirect.
import { verifyPassword } from './crypto.mjs'
import { sendHtml, redirect } from './http.mjs'

const LOOPBACK_REDIRECT = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/callback$/
const OAUTH_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope'
]

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Returns null when valid, else a short reason string.
function validateParams(p) {
  if (p.response_type !== 'code') return 'response_type must be code'
  if (p.code_challenge_method !== 'S256') return 'code_challenge_method must be S256'
  if (!p.code_challenge || !/^[A-Za-z0-9_-]{20,}$/.test(p.code_challenge))
    return 'invalid code_challenge'
  if (!p.redirect_uri || !LOOPBACK_REDIRECT.test(p.redirect_uri)) return 'invalid redirect_uri'
  if (!p.state) return 'missing state'
  if (!p.client_id) return 'missing client_id'
  return null
}

function errorPage(reason) {
  return `<!doctype html><meta charset="utf-8"><title>Login error</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h2>无法开始登录 / Cannot start login</h2><p>${escapeHtml(reason)}</p></body>`
}

function loginPage(p, errorMsg) {
  const hidden = OAUTH_FIELDS.map(
    (f) => `<input type="hidden" name="${f}" value="${escapeHtml(p[f])}">`
  ).join('\n      ')
  const err = errorMsg ? `<p style="color:#c00">${escapeHtml(errorMsg)}</p>` : ''
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 / Sign in</title>
<body style="font-family:system-ui;max-width:24rem;margin:4rem auto;padding:0 1rem">
  <h2>登录 / Sign in</h2>
  ${err}
  <form method="post" action="/oauth/authorize">
      ${hidden}
      <p><label>账号 / Username<br><input name="username" autocomplete="username" autofocus
         style="width:100%;padding:.5rem;box-sizing:border-box"></label></p>
      <p><label>密码 / Password<br><input name="password" type="password" autocomplete="current-password"
         style="width:100%;padding:.5rem;box-sizing:border-box"></label></p>
      <p><button type="submit" style="padding:.6rem 1.2rem">登录 / Sign in</button></p>
  </form>
  <p style="color:#666;font-size:.85rem">密码只输入在本页面（机场官网）。/ Your password is entered only here.</p>
</body>`
}

export function authorizeGet(query, res) {
  const reason = validateParams(query)
  if (reason) return sendHtml(res, 400, errorPage(reason))
  sendHtml(res, 200, loginPage(query))
}

export function authorizePost(form, ip, res, deps) {
  if (!deps.rateLimiter.hit(ip)) {
    return sendHtml(res, 429, errorPage('尝试过于频繁，请稍后再试 / Too many attempts'))
  }
  const reason = validateParams(form)
  if (reason) return sendHtml(res, 400, errorPage(reason))

  const user = deps.db.getUser(form.username)
  if (!user || !verifyPassword(form.password ?? '', user.pwdHash)) {
    return sendHtml(res, 200, loginPage(form, '账号或密码错误 / Wrong username or password'))
  }

  const code = deps.codes.issue({
    username: user.username,
    redirect_uri: form.redirect_uri,
    client_id: form.client_id,
    code_challenge: form.code_challenge
  })
  const url = new URL(form.redirect_uri)
  url.searchParams.set('code', code)
  url.searchParams.set('state', form.state)
  redirect(res, url.toString())
}
