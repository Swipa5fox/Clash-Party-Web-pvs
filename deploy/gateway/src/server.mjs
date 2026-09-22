// HTTP wiring. Caddy terminates TLS in front and reverse-proxies here over plain HTTP.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { openDb } from './db.mjs'
import { createCodeStore } from './codes.mjs'
import { createNonceStore } from './nonces.mjs'
import { createRateLimiter } from './ratelimit.mjs'
import { fetchSubscription } from './origin.mjs'
import { readBody, parseForm, parseJson, clientIp, sendJson, sendHtml, redirect } from './http.mjs'
import { authorizeGet, authorizePost } from './auth.mjs'
import { enroll, challenge, config as configHandler, revoke } from './gateway.mjs'
import { createProxy, isGatewayPath } from './proxy.mjs'
import { createPanelGate } from './panel-auth.mjs'

const BODY_MAX = 64 * 1024
const ENDPOINTS = {
  enroll: '/enroll',
  challenge: '/challenge',
  config: '/config',
  revoke: '/revoke'
}

export function createHandler(deps) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://gateway')
      const path = url.pathname
      const method = req.method

      if (method === 'GET' && path === '/.well-known/cpx-gateway') {
        return sendJson(res, 200, {
          spec: 'cpx-plugin/2',
          gateway: deps.config.publicOrigin,
          endpoints: ENDPOINTS
        })
      }

      if (path === '/oauth/authorize') {
        if (method === 'GET') return authorizeGet(Object.fromEntries(url.searchParams), res)
        if (method === 'POST') {
          const form = parseForm(await readBody(req, BODY_MAX))
          return authorizePost(form, clientIp(req), res, deps)
        }
      }

      if (method === 'POST' && Object.values(ENDPOINTS).includes(path)) {
        const body = parseJson(await readBody(req, BODY_MAX)) ?? {}
        if (path === ENDPOINTS.enroll) return enroll(body, res, deps)
        if (path === ENDPOINTS.challenge) return challenge(body, res, deps)
        if (path === ENDPOINTS.config) return configHandler(body, res, deps)
        if (path === ENDPOINTS.revoke) return revoke(body, res, deps)
      }

      // Panel gate sign-in. The browser proves it holds the deploy token once; the
      // session cookie then authorises its panel REST + WebSocket traffic.
      if (path === '/panel/login') {
        const gate = deps.gate
        if (!gate?.enabled) return redirect(res, panelSetupUrl(req))
        if (method === 'GET') {
          if (gate.isAuthed(req)) return redirect(res, panelSetupUrl(req))
          return sendHtml(res, 200, gate.loginPage())
        }
        if (method === 'POST') {
          const form = parseForm(await readBody(req, BODY_MAX))
          if (!deps.rateLimiter.hit(`panel:${clientIp(req)}`)) {
            return sendHtml(
              res,
              429,
              gate.loginPage({ error: '尝试过多 / Too many attempts, wait a minute' })
            )
          }
          if (!gate.checkToken(form.token)) {
            return sendHtml(res, 401, gate.loginPage({ error: '令牌不正确 / Wrong token' }))
          }
          res
            .writeHead(302, {
              'set-cookie': gate.cookieHeaders().set,
              location: panelSetupUrl(req)
            })
            .end()
          return
        }
      }

      if (path === '/panel/logout' && method === 'POST') {
        res
          .writeHead(302, {
            ...(deps.gate ? { 'set-cookie': deps.gate.cookieHeaders().clear } : {}),
            location: '/panel/login'
          })
          .end()
        return
      }

      // Everything the gateway does not own is either the panel entry point or
      // transparently proxied to the mihomo external-controller (single port).
      // ONLY '/' redirects: the target is /ui/#/setup?… whose fragment the
      // browser strips before requesting /ui/ — redirecting /ui or /ui/ again
      // would loop forever (ERR_TOO_MANY_REDIRECTS). mihomo serves /ui/ itself.
      if (!isGatewayPath(path) && deps.proxy) {
        // The mihomo API is a full admin surface (switch groups, rewrite configs,
        // drop connections), so it is never reachable without the session cookie.
        if (deps.gate?.enabled && !deps.gate.isAuthed(req)) {
          if (
            (method === 'GET' || method === 'HEAD') &&
            /text\/html/.test(req.headers.accept || '')
          )
            return redirect(res, '/panel/login')
          return sendJson(res, 401, { error: 'panel_unauthorized' })
        }
        if ((method === 'GET' || method === 'HEAD') && path === '/') {
          return redirect(res, panelSetupUrl(req))
        }
        return deps.proxy.handler(req, res)
      }

      sendJson(res, 404, { error: 'not_found' })
    } catch (e) {
      if (e?.message && /too large/.test(e.message))
        return sendJson(res, 413, { error: 'too_large' })
      sendJson(res, 500, { error: 'server_error' })
    }
  }
}

export function buildDeps(config) {
  const originCa = config.originCaFile ? readFileSync(config.originCaFile) : undefined
  return {
    db: openDb(config.dbPath),
    codes: createCodeStore({ ttlMs: config.codeTtlMs }),
    nonces: createNonceStore({ ttlMs: config.nonceTtlMs, poolMax: config.noncePoolMax }),
    rateLimiter: createRateLimiter({ max: config.loginMax, windowMs: config.loginWindowMs }),
    fetchSubscription,
    config: { ...config, originCa },
    gate: createPanelGate({ token: config.panelToken, ttlMs: config.panelSessionTtlMs }),
    proxy: config.mihomoApiUrl
      ? createProxy({ apiUrl: config.mihomoApiUrl, apiSecret: config.mihomoApiSecret })
      : undefined
  }
}

export function createServer(deps) {
  const server = http.createServer(createHandler(deps))
  // WebSocket streams (/traffic, /connections, /logs …) are tunneled to mihomo.
  // They carry real data and admin capability, so the gate applies here too — the
  // browser sends the session cookie on the upgrade handshake automatically.
  if (deps.proxy)
    server.on('upgrade', (req, socket, head) => {
      if (deps.gate?.enabled && !deps.gate.isAuthed(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      deps.proxy.upgrade(req, socket, head)
    })
  return server
}

// Auto-configure the panel on first visit: the metacubexd #/setup route accepts
// hostname/port and registers the backend without any manual secret entry. The
// values come from the Host header, so it adapts to whatever IP/domain:port the
// user browsed in — nothing is hardcoded.
export function panelSetupUrl(req) {
  const host = req.headers.host || '127.0.0.1'
  // Accepts "host", "host:port", "[v6]" and "[v6]:port" forms of the Host header.
  const m = host.match(/^(?:\[(.+)\]|([^:[\]]+))(?::(\d+))?$/)
  const hostname = m ? m[1] || m[2] || host : host
  const port = m?.[3] || ''
  const params = new URLSearchParams({ hostname })
  if (port) params.set('port', port)
  return `/ui/#/setup?${params.toString()}`
}

function main() {
  const config = loadConfig()
  if (!config.publicOrigin) {
    console.error('PUBLIC_ORIGIN is required (e.g. PUBLIC_ORIGIN=http://192.168.1.100:8080).')
    process.exit(1)
  }
  const deps = buildDeps(config)
  if (deps.proxy && !deps.gate.enabled) {
    console.warn(
      'WARNING: PANEL_TOKEN is empty — the mihomo control API is proxied on :' +
        `${config.port} with no authentication. Any host that can reach that port can ` +
        'switch groups, rewrite configs and drop connections. Set PANEL_TOKEN in .env.'
    )
  }
  createServer(deps).listen(config.port, '0.0.0.0', () => {
    console.log(`cpx-gateway listening on :${config.port} (public origin ${config.publicOrigin})`)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
