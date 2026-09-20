import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { isGatewayPath, createProxy } from './proxy.mjs'
import { createServer, panelSetupUrl } from './server.mjs'

// ---------------------------------------------------------------- isGatewayPath

test('isGatewayPath: gateway-owned paths are never proxied', () => {
  for (const p of [
    '/.well-known/cpx-gateway',
    '/oauth/authorize',
    '/enroll',
    '/challenge',
    '/config',
    '/revoke'
  ]) {
    assert.equal(isGatewayPath(p), true, p)
  }
})

test('isGatewayPath: mihomo API paths are proxied (incl. /configs vs gateway /config)', () => {
  for (const p of ['/', '/ui/', '/ui', '/version', '/configs', '/proxies', '/traffic', '/memory']) {
    assert.equal(isGatewayPath(p), false, p)
  }
  // prefix/queries do not make a gateway path
  assert.equal(isGatewayPath('/config/extra'), false)
  assert.equal(isGatewayPath('/enroll?x=1'), false)
})

// ---------------------------------------------------------------- panelSetupUrl

test('panelSetupUrl: derives hostname/port from Host header (ipv4, bare, ipv6)', () => {
  const mk = (host) => ({ headers: { host } })
  assert.equal(
    panelSetupUrl(mk('192.168.10.61:8080')),
    '/ui/#/setup?hostname=192.168.10.61&port=8080'
  )
  assert.equal(panelSetupUrl(mk('gw.lan')), '/ui/#/setup?hostname=gw.lan')
  assert.equal(panelSetupUrl(mk('[::1]:8080')), '/ui/#/setup?hostname=%3A%3A1&port=8080')
})

// ---------------------------------------------------------------- proxy integration

// Minimal fake mihomo controller: echoes REST + answers WS upgrades.
let upstream
let upstreamPort
let gateway
let base

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/version') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"meta":true,"version":"test"}')
      return
    }
    if (req.method === 'POST' && req.url === '/echo') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () =>
        res
          .writeHead(201, { 'content-type': 'application/json' })
          .end(JSON.stringify({ got: body }))
      )
      return
    }
    if (req.method === 'GET' && req.url === '/secret-check') {
      const auth = req.headers.authorization || 'none'
      res.writeHead(200).end(auth)
      return
    }
    // mihomo external-ui behavior: /ui redirects to /ui/, /ui/ serves the panel.
    if (req.method === 'GET' && req.url === '/ui') {
      res.writeHead(307, { location: '/ui/' }).end()
      return
    }
    if (req.method === 'GET' && req.url === '/ui/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('panel-index')
      return
    }
    res.writeHead(404).end()
  })
  // WebSocket endpoint
  upstream.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    const accept = createHash('sha256').update(key).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    socket.write('hello-from-upstream')
    socket.end()
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  upstreamPort = upstream.address().port

  const deps = {
    // Minimal real-shaped db: unknown device → 403 device_revoked, so gateway
    // endpoints answer locally (the fake upstream 404s everything).
    db: { getDevice: () => null, getUser: () => null, delDevice: () => {}, close: () => {} },
    codes: { issue: () => '' },
    nonces: { create: () => '' },
    rateLimiter: { check: () => true },
    fetchSubscription: async () => '',
    config: { publicOrigin: 'https://gw.test', retired: false },
    proxy: createProxy({ apiUrl: `http://127.0.0.1:${upstreamPort}`, apiSecret: '' })
  }
  gateway = createServer(deps)
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${gateway.address().port}`
})
after(async () => {
  await new Promise((r) => gateway.close(r))
  await new Promise((r) => upstream.close(r))
})

function request(method, path, { body, headers } = {}) {
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

test('proxies REST GET with status and body intact', async () => {
  const res = await request('GET', '/version')
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).version, 'test')
})

test('proxies REST POST with request body', async () => {
  const res = await request('POST', '/echo', {
    body: 'abc',
    headers: { 'content-type': 'text/plain' }
  })
  assert.equal(res.status, 201)
  assert.equal(JSON.parse(res.body).got, 'abc')
})

test('GET / redirects to the auto-setup panel URL', async () => {
  const res = await request('GET', '/')
  assert.equal(res.status, 302)
  assert.match(res.headers.location, /^\/ui\/#\/setup\?hostname=/)
})

test('GET /ui/ serves the panel via the proxy — never redirect (would loop)', async () => {
  // The redirect target for '/' is /ui/#/setup?… — browsers strip the fragment,
  // so a 302 on /ui/ sends them back to /ui/ forever (ERR_TOO_MANY_REDIRECTS).
  const res = await request('GET', '/ui/')
  assert.equal(res.status, 200)
  assert.equal(res.body, 'panel-index')
})

test('GET /ui passes mihomo’s /ui → /ui/ redirect through unmodified', async () => {
  const res = await request('GET', '/ui')
  assert.equal(res.status, 307)
  assert.equal(res.headers.location, '/ui/')
})

test('gateway endpoints still hit the gateway, not the proxy', async () => {
  // /config is gateway-owned; unknown device → 403 device_revoked straight from
  // the gateway. The fake upstream answers 404 for everything, so a 404 would
  // mean the request got proxied instead.
  const res = await request('POST', '/config', {
    body: '{}',
    headers: { 'content-type': 'application/json' }
  })
  assert.equal(res.status, 403)
  assert.equal(JSON.parse(res.body).error, 'device_revoked')
})

test('WebSocket upgrade is tunneled to the upstream', async () => {
  const key = createHash('sha256').update('x').digest('base64')
  const socket = net.connect(gateway.address().port, '127.0.0.1')
  const data = await new Promise((resolve, reject) => {
    let buf = ''
    socket.on('connect', () => {
      socket.write(
        `GET /traffic HTTP/1.1\r\n` +
          `Host: ${base.replace('http://', '')}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      )
    })
    socket.on('data', (c) => {
      buf += c.toString()
      if (buf.includes('hello-from-upstream')) {
        socket.destroy()
        resolve(buf)
      }
    })
    socket.on('error', reject)
    setTimeout(() => reject(new Error('ws tunnel timeout')), 3000)
  })
  assert.match(data, /^HTTP\/1\.1 101 Switching Protocols/)
  assert.match(data, /hello-from-upstream/)
})

test('upstream failure yields 502', async () => {
  const deps = {
    db: {},
    codes: {},
    nonces: {},
    rateLimiter: {},
    fetchSubscription: async () => '',
    config: {},
    proxy: createProxy({ apiUrl: 'http://127.0.0.1:1' }) // nothing listens on port 1
  }
  const srv = createServer(deps)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const res = await new Promise((resolve, reject) => {
    const rr = http.request(`http://127.0.0.1:${srv.address().port}/version`, (r2) => {
      const chunks = []
      r2.on('data', (c) => chunks.push(c))
      r2.on('end', () => resolve({ status: r2.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    rr.on('error', reject)
    rr.end()
  })
  await new Promise((r) => srv.close(r))
  assert.equal(res.status, 502)
  assert.equal(JSON.parse(res.body).error, 'bad_gateway')
})
