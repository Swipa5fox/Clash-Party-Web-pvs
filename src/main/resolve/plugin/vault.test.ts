import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeVault, readVault, removeVault } from './vault'

let TMP = ''

vi.mock('../../utils/dirs', () => ({
  pluginVaultDir: () => TMP,
  pluginVaultPath: (id: string) => join(TMP, `${id}.bin`)
}))

function sampleVault(): IPluginVault {
  return {
    deviceId: '11111111-1111-4111-8111-111111111111',
    gateway: {
      gateway: 'https://gw.front.com',
      endpoints: {
        enroll: '/enroll',
        challenge: '/challenge',
        config: '/config',
        revoke: '/revoke'
      }
    }
  }
}

function plainVault(vault: unknown = sampleVault()): string {
  return JSON.stringify(vault)
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cpxvault-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(TMP, { recursive: true, force: true })
})

describe('plaintext vault (LAN direct-access build)', () => {
  it('round-trips through a plaintext JSON file', async () => {
    await writeVault('p1', sampleVault())
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(true)

    const out = await readVault('p1')
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') {
      expect(out.vault.deviceId).toBe('11111111-1111-4111-8111-111111111111')
      expect(out.vault.gateway.gateway).toBe('https://gw.front.com')
    }
  })

  it('removes the file and reports it missing', async () => {
    await writeVault('p1', sampleVault())
    await removeVault('p1')
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(false)
    expect(await readVault('p1')).toEqual({ kind: 'missing' })
  })

  it('reads a file written by a previous session after a cold launch', async () => {
    writeFileSync(join(TMP, 'cold.bin'), plainVault())
    vi.resetModules()
    const fresh = await import('./vault')

    const out = await fresh.readVault('cold')
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.vault.gateway.gateway).toBe('https://gw.front.com')
  })

  it('checks material presence from the file only', async () => {
    writeFileSync(join(TMP, 'present.bin'), plainVault())
    vi.resetModules()
    const fresh = await import('./vault')

    expect(fresh.hasVaultMaterial('present')).toBe(true)
    expect(fresh.hasVaultMaterial('absent')).toBe(false)
  })

  it('classifies structurally invalid content as invalid', async () => {
    writeFileSync(join(TMP, 'bad.bin'), plainVault({ deviceId: 'not-a-uuid' }))
    writeFileSync(join(TMP, 'garbage.bin'), 'not json at all')
    vi.resetModules()
    const fresh = await import('./vault')

    expect(await fresh.readVault('bad')).toEqual({ kind: 'invalid' })
    expect(await fresh.readVault('garbage')).toEqual({ kind: 'invalid' })
  })

  it('rejects malformed endpoints but accepts a localhost gateway (direct-access build)', async () => {
    const base = { deviceId: '11111111-1111-4111-8111-111111111111' }
    const endpoints = { enroll: '/e', challenge: '/c', config: '/cfg', revoke: '/r' }
    const invalid: Array<[string, unknown]> = [
      [
        'protocol-relative',
        {
          ...base,
          gateway: {
            gateway: 'https://gw.front.com',
            endpoints: { ...endpoints, config: '//evil/cfg' }
          }
        }
      ]
    ]
    for (const [id, value] of invalid) writeFileSync(join(TMP, `${id}.bin`), plainVault(value))
    writeFileSync(
      join(TMP, 'local.bin'),
      plainVault({ ...base, gateway: { gateway: 'http://localhost:8080', endpoints } })
    )
    vi.resetModules()
    const fresh = await import('./vault')

    for (const [id] of invalid) expect(await fresh.readVault(id)).toEqual({ kind: 'invalid' })
    expect((await fresh.readVault('local')).kind).toBe('ok')
  })
})
