import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchSubscription } from './origin.mjs'

// Generate an ephemeral self-signed localhost cert at test time (no key committed to the repo).
function makeCert() {
  const dir = mkdtempSync(join(tmpdir(), 'cpxgw-cert-'))
  const keyPath = join(dir, 'k.pem')
  const certPath = join(dir, 'c.pem')
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1'
  ])
  return { dir, cert: readFileSync(certPath), key: readFileSync(keyPath) }
}

const CLASH = 'proxies:\n  - {name: a, type: ss}\n'
let server
let base
let tls

before(async () => {
  tls = makeCert()
  const { cert, key } = tls
  server = https.createServer({ cert, key }, (req, res) => {
    const u = new URL(req.url, 'https://127.0.0.1')
    if (u.pathname === '/sub')
      return void res.writeHead(200, { 'content-type': 'text/yaml' }).end(CLASH)
    if (u.pathname === '/big') return void res.writeHead(200).end('x'.repeat(100 * 1024))
    if (u.pathname === '/err') return void res.writeHead(500).end('nope')
    if (u.pathname === '/slow') return void setTimeout(() => res.writeHead(200).end(CLASH), 600)
    if (u.pathname === '/redir') return void res.writeHead(302, { location: `${base}/sub` }).end()
    if (u.pathname === '/downgrade')
      return void res.writeHead(302, { location: 'http://127.0.0.1:1/sub' }).end()
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `https://127.0.0.1:${server.address().port}`
})
after(() => {
  server.close()
  rmSync(tls.dir, { recursive: true, force: true })
})

const opts = () => ({ ca: tls.cert, timeoutMs: 2000, maxBytes: 10 * 1024 })

test('fetches a 200 body over https', async () => {
  assert.equal(await fetchSubscription(`${base}/sub`, opts()), CLASH)
})

test('rejects a non-https subscription url', async () => {
  await assert.rejects(fetchSubscription('http://127.0.0.1/sub', opts()), /https/)
})

test('throws on a non-2xx upstream', async () => {
  await assert.rejects(fetchSubscription(`${base}/err`, opts()), /status 500/)
})

test('throws when the body exceeds maxBytes', async () => {
  await assert.rejects(
    fetchSubscription(`${base}/big`, { ca: tls.cert, timeoutMs: 2000, maxBytes: 1024 }),
    /too large/
  )
})

test('throws on timeout', async () => {
  await assert.rejects(
    fetchSubscription(`${base}/slow`, { ca: tls.cert, timeoutMs: 100, maxBytes: 10 * 1024 }),
    /timed out/i
  )
})

test('follows an https redirect', async () => {
  assert.equal(await fetchSubscription(`${base}/redir`, opts()), CLASH)
})

test('rejects a redirect that downgrades to http', async () => {
  await assert.rejects(fetchSubscription(`${base}/downgrade`, opts()), /https/)
})
