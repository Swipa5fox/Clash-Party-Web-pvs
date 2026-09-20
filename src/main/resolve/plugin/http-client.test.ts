import http from 'http'
import { describe, it, expect, afterEach } from 'vitest'
import { requestOnce } from './http-client'

let server: http.Server | undefined
afterEach(() => server?.close())

function start(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

describe('requestOnce', () => {
  it('performs a GET and returns status + body', async () => {
    const url = await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    const r = await requestOnce(url + '/x', { method: 'GET', timeout: 5000, maxBytes: 1024 })
    expect(r.status).toBe(200)
    expect(r.body).toBe('{"ok":true}')
  })

  it('sends a POST body', async () => {
    const url = await start((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200)
        res.end(Buffer.concat(chunks).toString('utf-8'))
      })
    })
    const r = await requestOnce(url + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"a"}',
      timeout: 5000,
      maxBytes: 1024
    })
    expect(r.body).toBe('{"email":"a"}')
  })

  it('rejects redirects instead of following', async () => {
    const url = await start((_req, res) => {
      res.writeHead(302, { location: 'https://evil.example' })
      res.end()
    })
    await expect(
      requestOnce(url + '/r', { method: 'GET', timeout: 5000, maxBytes: 1024 })
    ).rejects.toThrow(/redirect/i)
  })

  it('rejects oversized responses', async () => {
    const url = await start((_req, res) => {
      res.writeHead(200)
      res.end('x'.repeat(5000))
    })
    await expect(
      requestOnce(url + '/big', { method: 'GET', timeout: 5000, maxBytes: 1000 })
    ).rejects.toThrow(/too large/i)
  })

  it('rejects forbidden headers', async () => {
    const url = await start((_req, res) => res.end('ok'))
    await expect(
      requestOnce(url + '/h', {
        method: 'GET',
        headers: { Host: 'evil' },
        timeout: 5000,
        maxBytes: 1024
      })
    ).rejects.toThrow(/forbidden/i)
  })

  it('rejects too many request headers', async () => {
    const url = await start((_req, res) => res.end('ok'))
    await expect(
      requestOnce(url + '/h', {
        method: 'GET',
        headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`X-Test-${i}`, 'v'])),
        timeout: 5000,
        maxBytes: 1024
      })
    ).rejects.toThrow(/headers/i)
  })

  it('rejects oversized request headers', async () => {
    const url = await start((_req, res) => res.end('ok'))
    await expect(
      requestOnce(url + '/h', {
        method: 'GET',
        headers: { 'X-Large': 'x'.repeat(16 * 1024 + 1) },
        timeout: 5000,
        maxBytes: 1024
      })
    ).rejects.toThrow(/headers/i)
  })

  it('times out slow responses', async () => {
    const url = await start((_req, res) => {
      setTimeout(() => res.end('late'), 200)
    })
    await expect(
      requestOnce(url + '/slow', { method: 'GET', timeout: 50, maxBytes: 1024 })
    ).rejects.toThrow(/timed out/i)
  })

  it('routes the request through the configured proxy when proxy is set', async () => {
    const seen: string[] = []
    const proxy = http.createServer((req, res) => {
      seen.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('via-proxy')
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()))
    const proxyPort = (proxy.address() as { port: number }).port
    try {
      // target.invalid 永不可解析：没走代理就连不上，证明请求确实经由代理发出
      const res = await requestOnce('http://target.invalid/getSub', {
        method: 'GET',
        timeout: 5000,
        maxBytes: 4096,
        proxy: { host: '127.0.0.1', port: proxyPort }
      })
      expect(res.body).toBe('via-proxy')
      expect(seen).toContain('http://target.invalid/getSub')
    } finally {
      proxy.close()
    }
  })
})
