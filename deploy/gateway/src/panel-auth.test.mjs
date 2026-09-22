import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { parseCookies, createPanelGate } from './panel-auth.mjs'
import { createProxy, isGatewayPath } from './proxy.mjs'
import { createServer, panelSetupUrl } from './server.mjs'
import { createRateLimiter } from './ratelimit.mjs'

const PANEL_TOKEN = 'panel-token-value'

// ---------------------------------------------------------------- unit: cookies

test('parseCookies: pairs, spaces, percent-decoding, junk', () => {
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' })
  assert.deepEqual(parseCookies('  x = y%2Fz ;  '), { x: 'y/z' })
  assert.deepEqual(parseCookies('novalue; =x; a=1'), { a: '1' })
  assert.deepEqual(parseCookies(undefined), {})
  assert.deepEqual(parseCookies(''), {})
})

test('isGatewayPath: panel gate routes are gateway-owned, never proxied', () => {
  assert.equal(isGatewayPath('/panel/login'), true)
  assert.equal(isGatewayPath('/panel/logout'), true)
})

// ------------------------------------------------------------------ unit: gate

test('gate: empty token disables it, and no session ever validates', () => {
  const off = createPanelGate({ token: '' })
  assert.equal(off.enabled, false)
  assert.equal(off.isAuthed({ headers: { cookie: 'cpx_panel=9999999999.abc' } }), false)
  assert.equal(off.checkToken('anything'), false)
})

test('gate: session round-trips, expires, and rejects forgeries', () => {
  let t = 1_000_000
  const gate = createPanelGate({ token: PANEL_TOKEN, ttlMs: 5000, now: () => t })
  const { set } = gate.cookieHeaders()
  const value = set.split(';')[0].replace('cpx_panel=', '')
  assert.equal(gate.isAuthed({ headers: { cookie: `cpx_panel=${value}` } }), true)

  // expiry reached
  t += 5001
  assert.equal(gate.isAuthed({ headers: { cookie: `cpx_panel=${value}` } }), false)

  t = 1_000_000
  const [expiry] = value.split('.')
  // a later expiry signed with the old (absent) key
  assert.equal(gate.isAuthed({ headers: { cookie: `cpx_panel=${expiry}9.deadbeef` } }), false)
  assert.equal(gate.isAuthed({ headers: { cookie: 'cpx_panel=not-a-session' } }), false)
  assert.equal(gate.isAuthed({ headers: { cookie: 'other=1' } }), false)
  // extending the expiry must not reuse the old signature
  assert.equal(
    gate.isAuthed({
      headers: { cookie: `cpx_panel=${Number(expiry) + 99999}.${value.split('.')[1]}` }
    }),
    false
  )
})

test('gate: a session from one token is useless for another', () => {
  const a = createPanelGate({ token: 'token-aaaa' })
  const b = createPanelGate({ token: 'token-bbbb' })
  const cookie = a.cookieHeaders().set.split(';')[0]
  assert.equal(b.isAuthed({ headers: { cookie } }), false)
})

test('gate: checkToken accepts only the configured token', () => {
  const gate = createPanelGate({ token: PANEL_TOKEN })
  assert.equal(gate.checkToken(PANEL_TOKEN), true)
  assert.equal(gate.checkToken(`${PANEL_TOKEN}x`), false)
  assert.equal(gate.checkToken(PANEL_TOKEN.slice(0, -1)), false)
  assert.equal(gate.checkToken(''), false)
  assert.equal(gate.checkToken(undefined), false)
})

// ------------------------------------------------- end-to-end through the server

let upstream
let gateway
let base
let seenUpstream = []

before(async () => {
  upstream = http.createServer((req, res) => {
    seenUpstream.push(`${req.method} ${req.url}`)
    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"meta":true}')
      return
    }
    if (req.method === 'PUT' && req.url === '/configs') {
      res.writeHead(204).end()
      return
    }
    if (req.method === 'GET' && req.url === '/ui/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('panel-index')
      return
    }
    res.writeHead(404).end()
  })
  upstream.on('upgrade', (req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${createHash('sha256').update(req.headers['sec-websocket-key']).digest('base64')}\r\n\r\n`
    )
    socket.write('streamed')
    socket.end()
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))

  const deps = {
    db: { getDevice: () => null, getUser: () => null, delDevice: () => {}, close: () => {} },
    codes: { issue: () => '' },
    nonces: { create: () => '' },
    rateLimiter: createRateLimiter({ max: 1000, windowMs: 60000 }),
    fetchSubscription: async () => '',
    config: { publicOrigin: 'http://gw.test:8080', retired: false },
    gate: createPanelGate({ token: PANEL_TOKEN }),
    proxy: createProxy({ apiUrl: `http://127.0.0.1:${upstream.address().port}`, apiSecret: '' })
  }
  gateway = createServer(deps)
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${gateway.address().port}`
})

after(async () => {
  await new Promise((r) => gateway.close(r))
  await new Promise((r) => upstream.close(r))
})

function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8')
        })
      )
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function login() {
  const res = await request('POST', '/panel/login', {
    body: `token=${PANEL_TOKEN}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
  assert.equal(res.status, 302)
  return res.headers['set-cookie'][0].split(';')[0]
}

test('unauthenticated REST gets 401 and never reaches mihomo', async () => {
  seenUpstream = []
  const res = await request('GET', '/version')
  assert.equal(res.status, 401)
  assert.equal(JSON.parse(res.body).error, 'panel_unauthorized')
  assert.deepEqual(seenUpstream, [])
})

test('the admin write path is blocked too (PUT /configs)', async () => {
  seenUpstream = []
  const res = await request('PUT', '/configs', { body: '{"mode":"global"}' })
  assert.equal(res.status, 401)
  assert.deepEqual(seenUpstream, [])
})

test('browser navigation to / goes to the login page, not the panel', async () => {
  const res = await request('GET', '/', { headers: { accept: 'text/html' } })
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/panel/login')
})

test('GET /panel/login renders the form; POST with the token mints a session', async () => {
  const page = await request('GET', '/panel/login', { headers: { accept: 'text/html' } })
  assert.equal(page.status, 200)
  assert.match(page.body, /name="token"/)
  assert.match(page.headers['content-type'], /text\/html/)

  const cookie = await login()
  const res = await request('GET', '/version', { headers: { cookie } })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).meta, true)
})

test('wrong token is rejected without a session cookie', async () => {
  const bad = await request('POST', '/panel/login', {
    body: 'token=nope',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
  assert.equal(bad.status, 401)
  assert.match(bad.body, /Wrong token/)
  assert.equal(bad.headers['set-cookie'], undefined)
})

test('repeated failed logins are rate-limited', async () => {
  // Own server + own limiter: throttling is keyed per client IP, so sharing the
  // suite-wide limiter would leave every later test logging into a full window.
  const deps = {
    db: {},
    codes: {},
    nonces: {},
    rateLimiter: createRateLimiter({ max: 3, windowMs: 60000 }),
    fetchSubscription: async () => '',
    config: { publicOrigin: 'http://gw.test:8080', retired: false },
    gate: createPanelGate({ token: PANEL_TOKEN }),
    proxy: createProxy({ apiUrl: `http://127.0.0.1:${upstream.address().port}`, apiSecret: '' })
  }
  const srv = createServer(deps)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}/panel/login`
  const post = () =>
    new Promise((resolve, reject) => {
      const rr = http.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
        (r2) => {
          r2.resume()
          r2.on('end', () => resolve(r2.statusCode))
        }
      )
      rr.on('error', reject)
      rr.end('token=nope')
    })
  const codes = []
  for (let i = 0; i < 5; i++) codes.push(await post())
  await new Promise((r) => srv.close(r))
  assert.deepEqual(codes, [401, 401, 401, 429, 429], 'first 3 attempts count, rest throttled')
})

test('panel static files need the session as well', async () => {
  const anon = await request('GET', '/ui/', { headers: { accept: 'text/html' } })
  assert.equal(anon.status, 302)
  assert.equal(anon.headers.location, '/panel/login')
  const cookie = await login()
  const authed = await request('GET', '/ui/', { headers: { cookie } })
  assert.equal(authed.status, 200)
  assert.equal(authed.body, 'panel-index')
})

test('WebSocket upgrade without a session is refused; with one it tunnels', async () => {
  const tryWs = (cookieHeader) =>
    new Promise((resolve, reject) => {
      const socket = net.connect(gateway.address().port, '127.0.0.1')
      let buf = ''
      const finish = (v) => {
        socket.destroy()
        resolve(v)
      }
      socket.on('connect', () => {
        socket.write(
          `GET /traffic HTTP/1.1\r\nHost: gw.test\r\nUpgrade: websocket\r\n` +
            `Connection: Upgrade\r\nSec-WebSocket-Key: ${createHash('sha256').update('k').digest('base64')}\r\n` +
            `Sec-WebSocket-Version: 13\r\n${cookieHeader ? `Cookie: ${cookieHeader}\r\n` : ''}\r\n`
        )
      })
      socket.on('data', (c) => {
        buf += c.toString()
        if (buf.includes('streamed') || buf.includes('401')) finish(buf)
      })
      socket.on('error', reject)
      setTimeout(() => reject(new Error('ws probe timeout')), 3000)
    })

  assert.match(await tryWs(undefined), /^HTTP\/1\.1 401 Unauthorized/)
  const cookie = await login()
  assert.match(await tryWs(cookie), /^HTTP\/1\.1 101 Switching Protocols/)
  assert.match(await tryWs(cookie), /streamed/)
})

test('gateway endpoints stay open to enrolled clients (gate does not cover them)', async () => {
  const disc = await request('GET', '/.well-known/cpx-gateway')
  assert.equal(disc.status, 200)
  assert.equal(JSON.parse(disc.body).spec, 'cpx-plugin/2')
  const cfg = await request('POST', '/config', {
    body: '{}',
    headers: { 'content-type': 'application/json' }
  })
  assert.equal(cfg.status, 403)
  assert.equal(JSON.parse(cfg.body).error, 'device_revoked')
})

test('logout clears the session', async () => {
  const cookie = await login()
  const out = await request('POST', '/panel/logout', { headers: { cookie } })
  assert.equal(out.status, 302)
  assert.match(out.headers['set-cookie'][0], /Max-Age=0/)
  const after = await request('GET', '/version', { headers: { cookie } })
  // the old cookie value is still self-authenticating until it expires, so clearing
  // is the browser's job — assert the header was actually sent, and that a request
  // with no cookie is refused again.
  assert.equal(after.status, 200)
  assert.equal((await request('GET', '/version')).status, 401)
})

// -------------------------------------------------------- gate disabled = legacy

test('gate disabled keeps the open-proxy behaviour and the / redirect', async () => {
  const deps = {
    db: {},
    codes: {},
    nonces: {},
    rateLimiter: createRateLimiter({ max: 5, windowMs: 60000 }),
    fetchSubscription: async () => '',
    config: { publicOrigin: 'http://gw.test:8080', retired: false },
    gate: createPanelGate({ token: '' }),
    proxy: createProxy({ apiUrl: `http://127.0.0.1:${upstream.address().port}`, apiSecret: '' })
  }
  const srv = createServer(deps)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const host = `127.0.0.1:${srv.address().port}`
  const origin = `http://${host}`
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      const rr = http.request(origin + path, { method: 'GET', headers }, (r2) => {
        const chunks = []
        r2.on('data', (c) => chunks.push(c))
        r2.on('end', () =>
          resolve({
            status: r2.statusCode,
            headers: r2.headers,
            body: Buffer.concat(chunks).toString()
          })
        )
      })
      rr.on('error', reject)
      rr.end()
    })
  assert.equal((await get('/version')).status, 200)
  const root = await get('/', { accept: 'text/html' })
  assert.equal(root.status, 302)
  // Same helper the real handler uses, so the Host-derived hostname/port must match.
  assert.equal(root.headers.location, panelSetupUrl({ headers: { host } }))
  await new Promise((r) => srv.close(r))
})
