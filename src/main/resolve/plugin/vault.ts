import { mkdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { pluginVaultDir, pluginVaultPath } from '../../utils/dirs'
import { atomicWriteFile } from '../../utils/safeFile'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'

// LAN direct-access build: the vault is stored as plaintext JSON on disk — no
// safeStorage/Keychain encryption, no device private key inside.

// Session read cache; the file on disk remains the source of truth.
const memoryVaults = new Map<string, IPluginVault>()

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type VaultReadResult =
  { kind: 'ok'; vault: IPluginVault } | { kind: 'missing' } | { kind: 'invalid' }

// 校验 vault 结构（deviceId 为 UUIDv4、网关为 http(s) origin、四个端点为相对 path）。
function isValidVault(v: unknown): v is IPluginVault {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.deviceId !== 'string' || !UUID_V4.test(o.deviceId)) return false
  const g = o.gateway as Record<string, unknown> | undefined
  if (!g || parseGatewayOrigin(g.gateway) === null) return false
  const e = g.endpoints as Record<string, unknown> | undefined
  if (!e) return false
  for (const k of ['enroll', 'challenge', 'config', 'revoke']) {
    if (!isValidEndpointPath(e[k])) return false
  }
  return true
}

// 启动审计只看缓存或文件是否存在。
export function hasVaultMaterial(id: string): boolean {
  return memoryVaults.has(id) || existsSync(pluginVaultPath(id))
}

export async function writeVault(id: string, vault: IPluginVault): Promise<void> {
  await mkdir(pluginVaultDir(), { recursive: true })
  await atomicWriteFile(pluginVaultPath(id), JSON.stringify(vault), { mode: 0o600 })
  memoryVaults.set(id, vault)
}

export async function readVault(id: string): Promise<VaultReadResult> {
  const cached = memoryVaults.get(id)
  if (cached) return { kind: 'ok', vault: cached }

  const path = pluginVaultPath(id)
  if (!existsSync(path)) return { kind: 'missing' }

  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown
    if (!isValidVault(parsed)) return { kind: 'invalid' }
    memoryVaults.set(id, parsed)
    return { kind: 'ok', vault: parsed }
  } catch {
    return { kind: 'invalid' }
  }
}

export async function removeVault(id: string): Promise<void> {
  memoryVaults.delete(id)
  await rm(pluginVaultPath(id), { force: true })
}
