import { execFileSync } from 'child_process'
import { stopCoreForExit, cleanupCoreWatcher } from './core/manager'
import { primeAdminPrivilegesCache } from './core/admin'
import { disableSysProxySync } from './sys/sysproxy'

function isWindowsElevatedSync(): boolean | null {
  if (process.platform !== 'win32') return false
  try {
    execFileSync('fltmc', [], { stdio: 'ignore', windowsHide: true, timeout: 800 })
    return true
  } catch {
    // 只有成功结果可安全缓存；所有失败交给异步 fltmc + net session 回退确认。
    return null
  }
}

export function setupLifecycle(): void {
  if (process.platform === 'win32') {
    const elevated = isWindowsElevatedSync()
    if (elevated === true) {
      primeAdminPrivilegesCache(true)
    }
  }

  let sysProxyDisabled = false
  let cleanupPromise: Promise<void> | null = null

  const withTimeout = async (promise: Promise<void>, timeout: number): Promise<void> => {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      await Promise.race([
        promise,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, timeout)
        })
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  const cleanupBeforeExit = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise

    cleanupPromise = (async () => {
      cleanupCoreWatcher()

      disableSysProxySync()
      sysProxyDisabled = true

      await withTimeout(
        Promise.allSettled([stopCoreForExit()]).then(() => {}),
        1200
      )
    })()

    return cleanupPromise
  }

  // SIGINT/SIGTERM（systemd stop / Ctrl-C）：清理内核与系统代理后退出。
  let signaled = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (signaled) return
    signaled = true
    void cleanupBeforeExit().finally(() => {
      if (!sysProxyDisabled) disableSysProxySync()
      // 不能用 process.kill(pid, signal) 自杀：Linux 上重发的信号仍进本 handler
      //（signaled=true 直接 return，默认终止已被监听器取代），进程永不退出，挂到 systemd 超时 SIGKILL
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
