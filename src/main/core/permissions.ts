import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import { getAppConfig, getControledMihomoConfig, patchControledMihomoConfig } from '../config'
import { mihomoCorePath } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import { broadcastEvent } from '../resolve/broadcaster'
import { checkAdminPrivileges } from './admin'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)

// 会话管理员状态缓存
let sessionAdminStatus: boolean | null = null

export async function initAdminStatus(): Promise<void> {
  if (process.platform === 'win32' && sessionAdminStatus === null) {
    sessionAdminStatus = await checkAdminPrivileges().catch(() => false)
  }
}

export function getSessionAdminStatus(): boolean {
  if (process.platform !== 'win32') {
    return true
  }
  return sessionAdminStatus ?? false
}

export { checkAdminPrivileges } from './admin'

export async function checkMihomoCorePermissions(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  try {
    if (process.platform === 'win32') {
      return await checkAdminPrivileges()
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const stats = await stat(corePath)
      return (stats.mode & 0o4000) !== 0 && stats.uid === 0
    }
  } catch {
    return false
  }

  return false
}

export async function checkHighPrivilegeCore(): Promise<boolean> {
  try {
    const { core = 'mihomo' } = await getAppConfig()
    const corePath = mihomoCorePath(core)

    managerLogger.info(`Checking high privilege core: ${corePath}`)

    if (process.platform === 'win32') {
      if (!existsSync(corePath)) {
        managerLogger.info('Core file does not exist')
        return false
      }

      const hasHighPrivilegeProcess = await checkHighPrivilegeMihomoProcess()
      if (hasHighPrivilegeProcess) {
        managerLogger.info('Found high privilege mihomo process running')
        return true
      }

      const isAdmin = await checkAdminPrivileges()
      managerLogger.info(`Current process admin privileges: ${isAdmin}`)
      return isAdmin
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      managerLogger.info('Non-Windows platform, skipping high privilege core check')
      return false
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege core', error)
    return false
  }

  return false
}

async function checkHighPrivilegeMihomoProcess(): Promise<boolean> {
  const mihomoExecutables =
    process.platform === 'win32'
      ? ['mihomo.exe', 'mihomo-alpha.exe', 'mihomo-smart.exe']
      : ['mihomo', 'mihomo-alpha', 'mihomo-smart']

  try {
    if (process.platform === 'win32') {
      let stdout = ''
      try {
        const result = await execFilePromise('tasklist', ['/FO', 'CSV', '/NH'], {
          windowsHide: true,
          timeout: 3000,
          maxBuffer: 4 * 1024 * 1024
        })
        stdout = result.stdout
      } catch (error) {
        managerLogger.error('Failed to list processes via tasklist', error)
        return false
      }

      const candidatePids: { pid: string; image: string }[] = []
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"([^"]+)","(\d+)"/)
        if (!match) continue
        const image = match[1].toLowerCase()
        if (mihomoExecutables.includes(image)) {
          candidatePids.push({ pid: match[2], image })
        }
      }

      if (candidatePids.length === 0) {
        managerLogger.info('No mihomo processes found running')
        return false
      }

      managerLogger.info(`Found ${candidatePids.length} mihomo processes running`)

      const pidArgs = candidatePids.map(({ pid }) => pid).join(',')
      try {
        const { stdout: processInfo } = await execFilePromise(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Get-Process -Id ${pidArgs} -ErrorAction SilentlyContinue | Select-Object Name,Id,Path | ConvertTo-Json -Compress`
          ],
          { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 }
        )

        if (!processInfo.trim()) return false

        const parsed = JSON.parse(processInfo)
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const proc of list) {
          if (
            proc &&
            typeof proc.Name === 'string' &&
            proc.Name.toLowerCase().includes('mihomo') &&
            proc.Path === null
          ) {
            return true
          }
        }
      } catch (error) {
        managerLogger.info('PowerShell process inspection failed', error)
      }
    } else {
      let foundProcesses = false

      for (const executable of mihomoExecutables) {
        try {
          const { stdout } = await execPromise(`ps aux | grep ${executable} | grep -v grep`)
          const lines = stdout
            .split('\n')
            .filter((line) => line.trim() && line.includes(executable))

          if (lines.length > 0) {
            foundProcesses = true
            managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.trim().split(/\s+/)
              if (parts.length >= 1) {
                const user = parts[0]
                managerLogger.info(`${executable} process running as user: ${user}`)

                if (user === 'root') {
                  return true
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!foundProcesses) {
        managerLogger.info('No mihomo processes found running')
      }
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege mihomo process', error)
  }

  return false
}

export async function validateTunPermissionsOnStartup(
  _restartCore: () => Promise<void>
): Promise<void> {
  const { tun } = await getControledMihomoConfig()

  if (!tun?.enable) {
    return
  }

  const hasPermissions = await checkMihomoCorePermissions()

  if (!hasPermissions) {
    // 启动时没有权限，静默禁用 TUN，不弹窗打扰用户
    managerLogger.warn(
      'TUN is enabled but insufficient permissions detected, auto-disabling TUN...'
    )
    await patchControledMihomoConfig({ tun: { enable: false } })

    broadcastEvent('controledMihomoConfigUpdated')

    managerLogger.info('TUN auto-disabled due to insufficient permissions on startup')
  } else {
    managerLogger.info('TUN permissions validated successfully')
  }
}

export async function checkAdminRestartForTun(restartCore: () => Promise<void>): Promise<void> {
  if (process.argv.includes('--admin-restart-for-tun')) {
    managerLogger.info('Detected admin restart for TUN mode, auto-enabling TUN...')

    try {
      if (process.platform === 'win32') {
        const hasAdminPrivileges = await checkAdminPrivileges()
        if (hasAdminPrivileges) {
          await patchControledMihomoConfig({ tun: { enable: true }, dns: { enable: true } })

          await restartCore()

          managerLogger.info('TUN mode auto-enabled after admin restart')

          broadcastEvent('controledMihomoConfigUpdated')
        } else {
          managerLogger.warn('Admin restart detected but no admin privileges found')
        }
      }
    } catch (error) {
      managerLogger.error('Failed to auto-enable TUN after admin restart', error)
    }
  } else {
    await validateTunPermissionsOnStartup(restartCore)
  }
}

export function checkTunPermissions(): Promise<boolean> {
  return checkMihomoCorePermissions()
}
