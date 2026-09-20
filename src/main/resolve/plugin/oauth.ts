import http from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'

export const CLIENT_ID = 'mihomo-party'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export interface PkcePair {
  verifier: string
  challenge: string
}

export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url') // 43 chars, RFC 7636 unreserved
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export interface OAuthResult {
  code: string
  verifier: string
  redirectUri: string
}

export interface BrowserLoginOpts {
  open?: (url: string) => void | Promise<unknown>
  timeoutMs?: number
}

export function browserLogin(loginUrl: string, opts: BrowserLoginOpts = {}): Promise<OAuthResult> {
  const { verifier, challenge } = generatePkce()
  const state = randomBytes(16).toString('base64url')
  const open = opts.open ?? ((u: string): Promise<void> => shell.openExternal(u))
  const timeoutMs = opts.timeoutMs ?? CALLBACK_TIMEOUT_MS

  const p = new Promise<OAuthResult>((resolve, reject) => {
    const server = http.createServer()
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('Login timed out'))), timeoutMs)

    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const code = reqUrl.searchParams.get('code')
      const retState = reqUrl.searchParams.get('state')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (!code || retState !== state) {
        res.end('<html><body>Login failed. You may close this window.</body></html>')
        finish(() => reject(new Error('Invalid OAuth callback (state mismatch or missing code)')))
        return
      }
      res.end('<html><body>Login complete. You may close this window.</body></html>')
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      finish(() => resolve({ code, verifier, redirectUri: `http://127.0.0.1:${port}/callback` }))
    })
    server.on('error', (e) => finish(() => reject(e)))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const authorize = new URL(loginUrl)
      authorize.searchParams.set('response_type', 'code')
      authorize.searchParams.set('client_id', CLIENT_ID)
      authorize.searchParams.set('redirect_uri', redirectUri)
      authorize.searchParams.set('code_challenge', challenge)
      authorize.searchParams.set('code_challenge_method', 'S256')
      authorize.searchParams.set('state', state)
      authorize.searchParams.set('scope', 'subscribe')
      // 同步异常与异步拒绝都收敛：打不开浏览器时立刻 reject 并关闭回环监听，不空等 5 分钟超时。
      void Promise.resolve()
        .then(() => open(authorize.toString()))
        .catch((err) =>
          finish(() => reject(err instanceof Error ? err : new Error('Failed to open browser')))
        )
    })
  })

  // Pre-attach an internal no-op handler so Node never sees p as unhandled,
  // even when rejection races ahead of the caller's await in the same event loop.
  // External .then()/.catch()/await on p still fire normally.
  p.catch((_e) => {})

  return p
}
