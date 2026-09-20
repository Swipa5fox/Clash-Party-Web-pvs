import http from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { describe, it, expect, vi } from 'vitest'
import { generatePkce, browserLogin } from './oauth'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

function get(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      .on('error', reject)
  })
}

describe('oauth PKCE', () => {
  it('challenge is S256(verifier) in base64url', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('browserLogin', () => {
  it('opens authorize with correct params, completes on matching state', async () => {
    let authorizeUrl = ''
    const p = browserLogin('https://panel.xx.com/oauth/authorize', {
      open: (u) => {
        authorizeUrl = u
      }
    })
    // wait a tick for the server to bind + open() to fire
    await new Promise((r) => setTimeout(r, 20))
    const au = new URL(authorizeUrl)
    expect(au.origin + au.pathname).toBe('https://panel.xx.com/oauth/authorize')
    expect(au.searchParams.get('response_type')).toBe('code')
    expect(au.searchParams.get('client_id')).toBe('mihomo-party')
    expect(au.searchParams.get('code_challenge_method')).toBe('S256')
    expect(au.searchParams.get('scope')).toBe('subscribe')
    const redirect = au.searchParams.get('redirect_uri') as string
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const state = au.searchParams.get('state') as string
    await get(`${redirect}?code=ABC&state=${state}`)
    const result = await p
    expect(result.code).toBe('ABC')
    expect(result.redirectUri).toBe(redirect)
    expect(result.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  })

  it('rejects on state mismatch', async () => {
    let redirect = ''
    const p = browserLogin('https://panel.xx.com/a', {
      open: (u) => {
        redirect = new URL(u).searchParams.get('redirect_uri') as string
      }
    })
    await new Promise((r) => setTimeout(r, 20))
    await get(`${redirect}?code=ABC&state=WRONG`)
    await expect(p).rejects.toThrow()
  })

  it('times out', async () => {
    const p = browserLogin('https://panel.xx.com/a', { open: () => {}, timeoutMs: 30 })
    await expect(p).rejects.toThrow(/timed out/)
  })

  it('rejects promptly when opening the browser rejects (no wait for timeout)', async () => {
    // timeoutMs high so a regression (silent wait) would hang past vitest's default test timeout
    const p = browserLogin('https://panel.xx.com/a', {
      open: () => Promise.reject(new Error('no browser')),
      timeoutMs: 60000
    })
    await expect(p).rejects.toThrow()
  })

  it('rejects when open throws synchronously', async () => {
    const p = browserLogin('https://panel.xx.com/a', {
      open: () => {
        throw new Error('boom')
      },
      timeoutMs: 60000
    })
    await expect(p).rejects.toThrow()
  })

  it('does not use an embedded webview', () => {
    const src = readFileSync(join(__dirname, 'oauth.ts'), 'utf-8')
    expect(src).not.toMatch(/BrowserWindow|webContents|webview|loadURL/)
  })
})
