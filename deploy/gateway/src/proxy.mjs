// Transparent reverse proxy to the mihomo external-controller.
// The gateway is the single published web port (:8080): gateway-owned paths are
// handled locally, everything else (panel UI / REST / WebSocket) is proxied to
// mihomo over the compose network. The controller port is never published to the
// host, so no secret is required — isolation is done by the docker network.
import http from 'node:http'

const GATEWAY_PATHS = new Set([
  '/.well-known/cpx-gateway',
  '/oauth/authorize',
  '/enroll',
  '/challenge',
  '/config',
  '/revoke',
  // Panel gate endpoints — must never reach mihomo, or the gate could not guard itself.
  '/panel/login',
  '/panel/logout'
])

// True when the gateway itself owns this exact path (never proxied).
// NOTE: gateway /config (singular, subscription hand-off) vs mihomo /configs (plural).
export function isGatewayPath(path) {
  return GATEWAY_PATHS.has(path)
}

// Hop-by-hop headers that must not be forwarded between the client and upstream.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host'
])

function forwardHeaders(req, target) {
  const headers = { ...req.headers }
  for (const h of HOP_BY_HOP) delete headers[h]
  headers.host = target.host // upstream routes by Host
  return headers
}

export function createProxy({ apiUrl, apiSecret = '' }) {
  const target = new URL(apiUrl)

  function handler(req, res) {
    const headers = forwardHeaders(req, target)
    if (apiSecret && !headers.authorization) {
      headers.authorization = `Bearer ${apiSecret}`
    }

    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers
      },
      (ures) => {
        const outHeaders = { ...ures.headers }
        for (const h of HOP_BY_HOP) delete outHeaders[h]
        res.writeHead(ures.statusCode, outHeaders)
        ures.pipe(res)
      }
    )

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ error: 'bad_gateway' }))
    })
    // client aborted → stop pulling from the upstream
    res.on('close', () => upstream.destroy())

    req.pipe(upstream)
  }

  // WebSocket tunnel: /traffic, /connections, /logs, /memory …
  function upgrade(req, socket, head) {
    const headers = forwardHeaders(req, target)
    headers.connection = 'Upgrade'
    headers.upgrade = req.headers.upgrade || 'websocket'

    const upstream = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: 'GET',
      path: req.url,
      headers
    })

    upstream.on('upgrade', (ures, usocket, uhead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          `Upgrade: ${ures.headers.upgrade || 'websocket'}\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Accept: ${ures.headers['sec-websocket-accept'] || ''}\r\n` +
          (ures.headers['sec-websocket-protocol']
            ? `Sec-WebSocket-Protocol: ${ures.headers['sec-websocket-protocol']}\r\n`
            : '') +
          `\r\n`
      )
      if (uhead?.length) socket.write(uhead)
      if (head?.length) usocket.write(head)
      usocket.pipe(socket)
      socket.pipe(usocket)
      const drop = () => {
        usocket.destroy()
        socket.destroy()
      }
      usocket.on('error', drop)
      socket.on('error', drop)
      usocket.on('close', drop)
      socket.on('close', drop)
    })

    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  return { handler, upgrade }
}
