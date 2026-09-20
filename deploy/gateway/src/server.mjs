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
import { readBody, parseForm, parseJson, clientIp, sendJson, redirect } from './http.mjs'
import { authorizeGet, authorizePost } from './auth.mjs'
import { enroll, challenge, config as configHandler, revoke } from './gateway.mjs'
import { createProxy, isGatewayPath } from './proxy.mjs'

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

      // Everything the gateway does not own is either the panel entry point or
      // transparently proxied to the mihomo external-controller (single port).
      // ONLY '/' redirects: the target is /ui/#/setup?… whose fragment the
      // browser strips before requesting /ui/ — redirecting /ui or /ui/ again
      // would loop forever (ERR_TOO_MANY_REDIRECTS). mihomo serves /ui/ itself.
      if (!isGatewayPath(path) && deps.proxy) {
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
    proxy: config.mihomoApiUrl
      ? createProxy({ apiUrl: config.mihomoApiUrl, apiSecret: config.mihomoApiSecret })
      : undefined
  }
}

export function createServer(deps) {
  const server = http.createServer(createHandler(deps))
  // WebSocket streams (/traffic, /connections, /logs …) are tunneled to mihomo.
  if (deps.proxy) server.on('upgrade', (req, socket, head) => deps.proxy.upgrade(req, socket, head))
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
  createServer(deps).listen(config.port, '0.0.0.0', () => {
    console.log(`cpx-gateway listening on :${config.port} (public origin ${config.publicOrigin})`)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
