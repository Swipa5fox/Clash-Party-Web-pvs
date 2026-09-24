import { spawn, execFileSync } from 'child_process'
import { app, powerMonitor } from 'electron'
import { stopCoreForExit, cleanupCoreWatcher } from './core/manager'
import { primeAdminPrivilegesCache } from './core/admin'
import { disableSysProxySync } from './sys/sysproxy'
import { exePath } from './utils/dirs'

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore'
  })
}

export function setupPlatformSpecifics(): void {
  if (process.platform === 'linux') {
    app.relaunch = customRelaunch
  }

  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  const electronMajor = parseInt(process.versions.electron.split('.')[0], 10) || 0
  if (process.platform === 'win32' && !exePath().startsWith('C') && electronMajor < 38) {
    app.commandLine.appendSwitch('in-process-gpu')
  }

  if (process.platform === 'win32') {
    const elevated = isWindowsElevatedSync()
    if (elevated === true) {
      primeAdminPrivilegesCache(true)
      app.commandLine.appendSwitch('disable-gpu-sandbox')
    }
  }
}

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

export function setupAppLifecycle(): void {
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

  app.on('before-quit', async (e) => {
    e.preventDefault()
    await cleanupBeforeExit()
    app.exit()
  })

  powerMonitor.on('shutdown', async () => {
    await cleanupBeforeExit()
    app.exit()
  })

  app.on('will-quit', () => {
    if (!sysProxyDisabled) {
      disableSysProxySync()
    }
  })
}

export function getSystemLanguage(): 'zh-CN' | 'en-US' {
  const locale = app.getLocale()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
