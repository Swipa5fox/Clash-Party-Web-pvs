import { execFile } from 'child_process'
import { promisify } from 'util'
import { managerLogger } from '../utils/logger'

const execFilePromise = promisify(execFile)

// admin 状态在 Node 进程生命周期内不会变化，永久缓存
let adminPrivilegePromise: Promise<boolean> | null = null

// 允许 lifecycle.ts 同步检测的结果直接填入缓存，避免重复跑一次 fltmc
export function primeAdminPrivilegesCache(value: boolean): void {
  if (adminPrivilegePromise) return
  adminPrivilegePromise = Promise.resolve(value)
  managerLogger.info(`Admin privileges primed from sync check: ${value}`)
}

export async function checkAdminPrivileges(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true
  }

  if (adminPrivilegePromise) return adminPrivilegePromise

  adminPrivilegePromise = (async () => {
    try {
      await execFilePromise('fltmc', [], { windowsHide: true, timeout: 1500 })
      managerLogger.info('Admin privileges confirmed via fltmc')
      return true
    } catch (fltmcError: unknown) {
      const errorCode = (fltmcError as { code?: number })?.code || 0
      managerLogger.debug(`fltmc failed with code ${errorCode}, trying net session as fallback`)

      try {
        await execFilePromise('net', ['session'], { windowsHide: true, timeout: 1500 })
        managerLogger.info('Admin privileges confirmed via net session')
        return true
      } catch (netSessionError: unknown) {
        const netErrorCode = (netSessionError as { code?: number })?.code || 0
        managerLogger.debug(
          `Both fltmc and net session failed, no admin privileges. Error codes: fltmc=${errorCode}, net=${netErrorCode}`
        )
        return false
      }
    }
  })()

  return adminPrivilegePromise
}
