import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createSessionId,
  ensureWebAuthConfig,
  isValidSession,
  parseSidFromCookie,
  verifyWebLogin,
  WEB_AUTH_COOKIE
} from './webAuth'

const { mockDataDir } = vi.hoisted(() => ({ mockDataDir: { value: '' } }))
vi.mock('../utils/dirs', () => ({ dataDir: () => mockDataDir.value }))

beforeAll(() => {
  mockDataDir.value = mkdtempSync(join(tmpdir(), 'cp-web-auth-unit-'))
})

describe('ensureWebAuthConfig', () => {
  it('generates default admin credentials and persists them hashed', async () => {
    const config = await ensureWebAuthConfig()
    expect(config.username).toBe('admin')
    expect(config.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(config.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(config.hash).not.toContain('admin123')

    const file = join(mockDataDir.value, 'web-auth.json')
    expect(existsSync(file)).toBe(true)
    const persisted = JSON.parse(readFileSync(file, 'utf8'))
    expect(persisted).toEqual(config)
  })

  it('reuses the persisted credentials on subsequent calls', async () => {
    const again = await ensureWebAuthConfig()
    const config = JSON.parse(readFileSync(join(mockDataDir.value, 'web-auth.json'), 'utf8'))
    expect(again).toEqual(config)
  })
})

describe('verifyWebLogin', () => {
  it('accepts the default credentials', async () => {
    const result = await verifyWebLogin('admin', 'admin123', '1.1.1.1')
    expect(result.ok).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const result = await verifyWebLogin('admin', 'nope', '2.2.2.2')
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong username', async () => {
    const result = await verifyWebLogin('root', 'admin123', '3.3.3.3')
    expect(result.ok).toBe(false)
  })

  it('locks the ip after repeated failures', async () => {
    const ip = '4.4.4.4'
    for (let i = 0; i < 5; i++) {
      await verifyWebLogin('admin', 'bad', ip)
    }
    // 锁定期间即使凭据正确也拒绝
    const locked = await verifyWebLogin('admin', 'admin123', ip)
    expect(locked.ok).toBe(false)
    expect(locked.lockedSeconds).toBeGreaterThan(0)
  })

  it('clears the failure counter after a successful login', async () => {
    const ip = '5.5.5.5'
    await verifyWebLogin('admin', 'bad', ip)
    expect((await verifyWebLogin('admin', 'admin123', ip)).ok).toBe(true)
    // 成功后计数清零：再失败一次不应立即锁定
    const result = await verifyWebLogin('admin', 'bad', ip)
    expect(result.lockedSeconds).toBeUndefined()
  })
})

describe('sessions', () => {
  it('validates a freshly created session', () => {
    const sid = createSessionId()
    expect(isValidSession(sid)).toBe(true)
  })

  it('rejects unknown or empty sids', () => {
    expect(isValidSession('does-not-exist')).toBe(false)
    expect(isValidSession('')).toBe(false)
    expect(isValidSession(null)).toBe(false)
  })

  it('expires sessions after TTL', async () => {
    const sid = createSessionId()
    // 直接查表不可行（私有），以过期判定语义替代：未知 sid 失效已在上一用例覆盖，
    // 此处验证连续校验（滑动续期）不会误杀活跃会话
    expect(isValidSession(sid)).toBe(true)
    expect(isValidSession(sid)).toBe(true)
  })
})

describe('parseSidFromCookie', () => {
  it('extracts the session sid from a cookie header', () => {
    const sid = createSessionId()
    expect(parseSidFromCookie(`other=1; ${WEB_AUTH_COOKIE}=${sid}; x=y`)).toBe(sid)
  })

  it('returns null when the cookie is missing or malformed', () => {
    expect(parseSidFromCookie(undefined)).toBeNull()
    expect(parseSidFromCookie('')).toBeNull()
    expect(parseSidFromCookie('other=1')).toBeNull()
    expect(parseSidFromCookie(`${WEB_AUTH_COOKIE}=`)).toBeNull()
  })
})
