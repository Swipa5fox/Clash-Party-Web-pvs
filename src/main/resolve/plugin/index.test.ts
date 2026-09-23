import { describe, it, expect, beforeEach, vi } from 'vitest'

const profiles: Record<string, string> = {}
const pluginItems: Record<string, IPluginItem> = {}
const vaults: Record<string, IPluginVault> = {}
const invalidVaults = new Set<string>()
const unwritableVaults = new Set<string>()

vi.mock('./vault', () => ({
  writeVault: vi.fn(async (id: string, v: IPluginVault) => {
    if (unwritableVaults.has(id)) throw new Error('Plugin vault is temporarily unavailable')
    vaults[id] = v
  }),
  readVault: vi.fn(async (id: string) => {
    if (invalidVaults.has(id)) return { kind: 'invalid' as const }
    return vaults[id] ? { kind: 'ok' as const, vault: vaults[id] } : { kind: 'missing' as const }
  }),
  hasVaultMaterial: vi.fn((id: string) => id in vaults),
  removeVault: vi.fn(async (id: string) => {
    delete vaults[id]
  })
}))
vi.mock('../../config/plugin', () => ({
  getPluginItem: vi.fn(async (id: string) => pluginItems[id]),
  addPluginItem: vi.fn(async (i: IPluginItem) => {
    pluginItems[i.id] = i
  }),
  updatePluginItem: vi.fn(async (i: IPluginItem) => {
    pluginItems[i.id] = i
  }),
  removePluginItem: vi.fn(async (id: string) => {
    delete pluginItems[id]
  }),
  getPluginConfig: vi.fn(async () => ({ items: Object.values(pluginItems) }))
}))
vi.mock('../../config/profile', () => ({
  upsertPluginProfile: vi.fn(async (meta: { profileId: string }, content: string) => {
    profiles[meta.profileId] = content
  }),
  removePluginProfileContent: vi.fn(async (pid: string) => {
    delete profiles[pid]
  })
}))
vi.mock('../../config/app', () => ({
  getAppConfig: vi.fn(async () => ({ subscriptionTimeout: 5000 }))
}))
vi.mock('../broadcaster', () => ({ broadcastEvent: vi.fn() }))

const discoverGateway = vi.fn()
vi.mock('./discovery', () => ({ discoverGateway: (...a: unknown[]) => discoverGateway(...a) }))
const browserLogin = vi.fn()
vi.mock('./oauth', () => ({
  browserLogin: (...a: unknown[]) => browserLogin(...a),
  CLIENT_ID: 'mihomo-party'
}))
const enroll = vi.fn()
const fetchConfig = vi.fn()
const revoke = vi.fn()
vi.mock('./gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gateway')>()
  return {
    GatewayError: real.GatewayError,
    enroll: (...a: unknown[]) => enroll(...a),
    fetchConfig: (...a: unknown[]) => fetchConfig(...a),
    revoke: (...a: unknown[]) => revoke(...a)
  }
})

import { GatewayError } from './gateway'
import { readVault as readVaultMock } from './vault'
import {
  previewPlugin,
  installPlugin,
  loginPlugin,
  updatePluginProfile,
  auditPluginVault,
  removePlugin
} from './index'

const CLASH =
  'proxies:\n  - {name: a, type: ss, server: 1.1.1.1, port: 8388, cipher: aes-128-gcm, password: x}\n'
const WK = {
  spec: 'cpx-plugin/2',
  gateway: 'https://gw.front.com',
  endpoints: { enroll: '/enroll', challenge: '/challenge', config: '/config', revoke: '/revoke' }
}
function file(): string {
  return Buffer.from(
    JSON.stringify({
      magic: 'CPXF',
      v: 2,
      spec: 'cpx-plugin/2',
      loginUrl: 'https://panel.xx.com/oauth/authorize',
      provider: { name: 'XX', site: 'https://xx.com' }
    }),
    'utf-8'
  ).toString('base64')
}

beforeEach(() => {
  for (const k of Object.keys(profiles)) delete profiles[k]
  for (const k of Object.keys(pluginItems)) delete pluginItems[k]
  for (const k of Object.keys(vaults)) delete vaults[k]
  invalidVaults.clear()
  unwritableVaults.clear()
  discoverGateway.mockReset().mockResolvedValue(WK)
  browserLogin.mockReset().mockResolvedValue({
    code: 'C',
    verifier: 'V',
    redirectUri: 'http://127.0.0.1:1/callback'
  })
  enroll.mockReset().mockResolvedValue(undefined)
  fetchConfig.mockReset().mockResolvedValue(CLASH)
  revoke.mockReset().mockResolvedValue(undefined)
})

describe('previewPlugin', () => {
  it('returns the display subset without creating records or touching network', async () => {
    const p = await previewPlugin(file())
    expect(p.name).toBe('XX')
    expect(p.loginUrl).toBe('https://panel.xx.com/oauth/authorize')
    expect(Object.keys(pluginItems)).toHaveLength(0)
    expect(discoverGateway).not.toHaveBeenCalled()
  })
  it('rejects an invalid file', async () => {
    await expect(previewPlugin(Buffer.from('{bad', 'utf-8').toString('base64'))).rejects.toThrow()
  })
})

describe('installPlugin', () => {
  it('creates a needs-login record with no profileId and no network', async () => {
    const item = await installPlugin(file())
    expect(item.status).toBe('needs-login')
    expect(item.profileId).toBeUndefined()
    expect(item.loginUrl).toBe('https://panel.xx.com/oauth/authorize')
    expect(discoverGateway).not.toHaveBeenCalled()
    expect(browserLogin).not.toHaveBeenCalled()
  })
})

describe('loginPlugin', () => {
  it('discovers, generates device, browser-logs-in, enrolls, writes vault, fetches profile, active', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    const rec = pluginItems[item.id]
    expect(rec.status).toBe('active')
    expect(rec.profileId).toBeDefined()
    expect(profiles[rec.profileId!]).toBe(CLASH)
    const vault = vaults[item.id]
    expect(vault.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(vault.gateway.gateway).toBe('https://gw.front.com')
    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'https://gw.front.com' }),
      expect.objectContaining({ code: 'C', code_verifier: 'V', client_id: 'mihomo-party' }),
      expect.any(Object)
    )
  })

  it('best-effort revokes a newly enrolled device when vault persistence fails', async () => {
    const item = await installPlugin(file())
    unwritableVaults.add(item.id)

    await expect(loginPlugin(item.id)).rejects.toThrow('PLUGIN_LOGIN_FAILED')
    expect(enroll).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: WK.gateway }),
      expect.objectContaining({ deviceId: expect.any(String) }),
      expect.any(Object)
    )
    expect(pluginItems[item.id].status).toBe('needs-login')
  })

  it('re-login (reauth) after restart works from the persisted loginUrl alone (no reimport)', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    delete vaults[item.id]
    pluginItems[item.id] = { ...pluginItems[item.id], status: 'needs-reauth' }
    await loginPlugin(item.id)
    expect(pluginItems[item.id].status).toBe('active')
    expect(vaults[item.id]).toBeDefined()
  })

  // 设备复用仅限 needs-login 的“孤儿设备”（上次 enroll 成功但首份订阅拉取失败）
  it('reuses an orphaned device (needs-login + vault) without browser/enroll', async () => {
    const item = await installPlugin(file()) // needs-login, no vault
    const dev = { deviceId: '11111111-1111-4111-8111-111111111111' }
    vaults[item.id] = { ...dev, gateway: { gateway: WK.gateway, endpoints: WK.endpoints } }
    browserLogin.mockClear()
    enroll.mockClear()
    discoverGateway.mockClear()
    await loginPlugin(item.id)
    expect(browserLogin).not.toHaveBeenCalled()
    expect(enroll).not.toHaveBeenCalled()
    expect(discoverGateway).not.toHaveBeenCalled()
    expect(fetchConfig).toHaveBeenCalled()
    expect(vaults[item.id].deviceId).toBe(dev.deviceId)
    expect(pluginItems[item.id].status).toBe('active')
  })

  it('falls back to browser login + new device if the orphaned device is revoked', async () => {
    const item = await installPlugin(file())
    const dev = { deviceId: '22222222-2222-4222-8222-222222222222' }
    vaults[item.id] = { ...dev, gateway: { gateway: WK.gateway, endpoints: WK.endpoints } }
    browserLogin.mockClear()
    enroll.mockClear()
    fetchConfig
      .mockRejectedValueOnce(new GatewayError('revoked', 'revoked')) // reuse attempt
      .mockResolvedValueOnce(CLASH) // full-flow first fetch
    await loginPlugin(item.id)
    expect(browserLogin).toHaveBeenCalled()
    expect(enroll).toHaveBeenCalled()
    expect(pluginItems[item.id].status).toBe('active')
    expect(vaults[item.id].deviceId).not.toBe(dev.deviceId)
  })

  // spec §9：显式重新登录（needs-reauth）必须再走浏览器登录 + 新设备，即便 vault 仍在也不复用
  it('explicit re-login (needs-reauth) does a fresh browser login + new device even with a vault', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id) // active, vault written
    const deviceIdBefore = vaults[item.id].deviceId
    pluginItems[item.id] = { ...pluginItems[item.id], status: 'needs-reauth' } // vault still present
    browserLogin.mockClear()
    enroll.mockClear()
    fetchConfig.mockClear()
    await loginPlugin(item.id)
    expect(browserLogin).toHaveBeenCalled()
    expect(enroll).toHaveBeenCalled()
    expect(pluginItems[item.id].status).toBe('active')
    expect(vaults[item.id].deviceId).not.toBe(deviceIdBefore)
  })

  it('sanitizes login errors (no gateway host / network detail leaks to the caller)', async () => {
    const item = await installPlugin(file())
    fetchConfig.mockRejectedValueOnce(
      new GatewayError('unreachable', 'getaddrinfo ENOTFOUND gw.secret.host')
    )
    const err = (await loginPlugin(item.id).catch((e) => e)) as Error
    expect(err.message).toBe('PLUGIN_LOGIN_NETWORK')
    expect(err.message).not.toContain('gw.secret.host')
  })
})

describe('updatePluginProfile', () => {
  it('signed silent fetch refreshes the profile and clears failure state', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    fetchConfig.mockResolvedValueOnce(
      'proxies: [{name: b, type: ss, server: 2.2.2.2, port: 1, cipher: aes-128-gcm, password: y}]\n'
    )
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('active')
    expect(pluginItems[item.id].failureCount ?? 0).toBe(0)
  })

  it('revoked → needs-reauth (no backoff)', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    fetchConfig.mockRejectedValueOnce(new GatewayError('revoked', 'revoked'))
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('needs-reauth')
  })

  it('transient failure keeps old profile + sets backoff', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    const before = profiles[pluginItems[item.id].profileId!]
    fetchConfig.mockRejectedValueOnce(new GatewayError('transient', 'timeout'))
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('active')
    expect(pluginItems[item.id].failureCount).toBe(1)
    expect(pluginItems[item.id].nextRetryAt).toBeGreaterThan(Date.now())
    expect(profiles[pluginItems[item.id].profileId!]).toBe(before)
  })

  it('backoff success clears failure state', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    pluginItems[item.id] = {
      ...pluginItems[item.id],
      failureCount: 2,
      nextRetryAt: Date.now() - 1,
      lastUpdateErrorType: 'transient'
    }
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].failureCount).toBe(0)
    expect(pluginItems[item.id].lastUpdateErrorType).toBeUndefined()
  })

  it('respects nextRetryAt unless forced', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    pluginItems[item.id] = { ...pluginItems[item.id], nextRetryAt: Date.now() + 60000 }
    fetchConfig.mockClear()
    await updatePluginProfile(item.id)
    expect(fetchConfig).not.toHaveBeenCalled()
    await updatePluginProfile(item.id, true)
    expect(fetchConfig).toHaveBeenCalled()
  })

  it('vault missing → needs-reauth', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    delete vaults[item.id]
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('needs-reauth')
  })

  it('permanently invalid vault → needs-reauth', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    invalidVaults.add(item.id)

    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('needs-reauth')
  })

  it('corrupt active record (no profileId) → needs-reauth, never writes undefined.yaml', async () => {
    const item = await installPlugin(file())
    pluginItems[item.id] = { ...pluginItems[item.id], status: 'active', profileId: undefined }
    fetchConfig.mockClear()
    await updatePluginProfile(item.id)
    expect(pluginItems[item.id].status).toBe('needs-reauth')
    expect(fetchConfig).not.toHaveBeenCalled()
  })

  it('re-discovers and retries once on a retired gateway', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    discoverGateway.mockClear()
    fetchConfig
      .mockRejectedValueOnce(new GatewayError('retired', 'gone'))
      .mockResolvedValueOnce(CLASH)
    discoverGateway.mockResolvedValueOnce({
      ...WK,
      gateway: 'https://gw2.front.com'
    })
    await updatePluginProfile(item.id)
    expect(discoverGateway).toHaveBeenCalledTimes(1)
    expect(vaults[item.id].gateway.gateway).toBe('https://gw2.front.com')
    expect(pluginItems[item.id].status).toBe('active')
  })

  it('re-discovers and retries once on an unreachable gateway (dead/retired domain)', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    discoverGateway.mockClear()
    fetchConfig
      .mockRejectedValueOnce(new GatewayError('unreachable', 'ENOTFOUND'))
      .mockResolvedValueOnce(CLASH)
    discoverGateway.mockResolvedValueOnce({ ...WK, gateway: 'https://gw3.front.com' })
    await updatePluginProfile(item.id)
    expect(discoverGateway).toHaveBeenCalledTimes(1)
    expect(vaults[item.id].gateway.gateway).toBe('https://gw3.front.com')
    expect(pluginItems[item.id].status).toBe('active')
  })

  it('does nothing for needs-login / needs-reauth statuses', async () => {
    const item = await installPlugin(file())
    fetchConfig.mockClear()
    await updatePluginProfile(item.id)
    expect(fetchConfig).not.toHaveBeenCalled()
  })
})

describe('auditPluginVault', () => {
  it('checks material presence without decrypting an existing vault', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    vi.mocked(readVaultMock).mockClear()

    await auditPluginVault(item.id)

    expect(readVaultMock).not.toHaveBeenCalled()
    expect(pluginItems[item.id].status).toBe('active')
  })

  it('marks an active plugin with a missing vault as needs-reauth', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    delete vaults[item.id]
    await auditPluginVault(item.id)
    expect(pluginItems[item.id].status).toBe('needs-reauth')
  })
  it('leaves a needs-login plugin alone', async () => {
    const item = await installPlugin(file())
    await auditPluginVault(item.id)
    expect(pluginItems[item.id].status).toBe('needs-login')
  })
})

describe('removePlugin', () => {
  it('best-effort revokes then removes profile + record + vault', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    const pid = pluginItems[item.id].profileId!
    await removePlugin(item.id)
    expect(revoke).toHaveBeenCalled()
    expect(pluginItems[item.id]).toBeUndefined()
    expect(vaults[item.id]).toBeUndefined()
    expect(profiles[pid]).toBeUndefined()
  })
  it('completes local deletion even if revoke fails', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    revoke.mockRejectedValueOnce(new GatewayError('transient', 'net'))
    await removePlugin(item.id)
    expect(pluginItems[item.id]).toBeUndefined()
    expect(vaults[item.id]).toBeUndefined()
  })
  it('re-discovers and revokes against the new gateway when the cached one is retired', async () => {
    const item = await installPlugin(file())
    await loginPlugin(item.id)
    discoverGateway.mockClear()
    revoke
      .mockRejectedValueOnce(new GatewayError('retired', 'gone'))
      .mockResolvedValueOnce(undefined)
    discoverGateway.mockResolvedValueOnce({ ...WK, gateway: 'https://gw4.front.com' })
    await removePlugin(item.id)
    expect(discoverGateway).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledTimes(2)
    expect(pluginItems[item.id]).toBeUndefined()
    expect(vaults[item.id]).toBeUndefined()
  })
})
