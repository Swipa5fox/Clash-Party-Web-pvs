import { triggerAutoProxy, triggerManualProxy } from 'sysproxy-rs'
import { net } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { proxyLogger } from '../utils/logger'
import { isContainerDeployment } from '../utils/deployment'

let triggerSysProxyTimer: NodeJS.Timeout | null = null
let triggerSysProxyQueue: Promise<void> = Promise.resolve()
let triggerSysProxySequence = 0

const defaultBypass: string[] = (() => {
  switch (process.platform) {
    case 'linux':
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
    case 'win32':
      return [
        'localhost',
        '127.*',
        '192.168.*',
        '10.*',
        '172.16.*',
        '172.17.*',
        '172.18.*',
        '172.19.*',
        '172.20.*',
        '172.21.*',
        '172.22.*',
        '172.23.*',
        '172.24.*',
        '172.25.*',
        '172.26.*',
        '172.27.*',
        '172.28.*',
        '172.29.*',
        '172.30.*',
        '172.31.*',
        '<local>'
      ]
    default:
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
  }
})()

interface TriggerSysProxyOptions {
  force?: boolean
}

export async function triggerSysProxy(
  enable: boolean,
  options: TriggerSysProxyOptions = {}
): Promise<void> {
  // 容器部署（cpx-party 镜像）内没有宿主机桌面环境，sysproxy-rs 的原生调用
  // 必然失败（如 Linux 上找不到 gsettings → "No such file or directory"）。
  // 在这里给出明确错误，让前端 toast 显示可操作的提示而非底层 os error。
  if (isContainerDeployment()) {
    throw new Error('容器部署不支持系统代理：请让各设备手动配置代理地址 http://<主机IP>:7890')
  }

  const sequence = ++triggerSysProxySequence

  if (triggerSysProxyTimer) {
    clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = null
  }

  const operation = triggerSysProxyQueue.then(async () => {
    if (net.isOnline() || options.force) {
      if (enable) {
        await disableSysProxy()
        await enableSysProxy()
      } else {
        await disableSysProxy()
      }
      return
    }

    if (sequence !== triggerSysProxySequence) return
    triggerSysProxyTimer = setTimeout(() => {
      triggerSysProxyTimer = null
      if (sequence !== triggerSysProxySequence) return
      void triggerSysProxy(enable, options).catch((error) => {
        void proxyLogger.error('Failed to retry system proxy', error)
      })
    }, 5000)
  })

  triggerSysProxyQueue = operation.catch(() => {})
  return operation
}

async function enableSysProxy(): Promise<void> {
  await startPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass } = sysProxy
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const proxyHost = host || '127.0.0.1'
  const formattedBypass = bypass
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ',')

  try {
    if (mode === 'auto') {
      triggerAutoProxy(true, `http://${proxyHost}:${pacPort}/pac`)
    } else {
      triggerManualProxy(true, proxyHost, port, formattedBypass)
    }
  } catch (error) {
    await proxyLogger.error('Failed to enable system proxy', error)
    throw error
  }
}

async function disableSysProxy(): Promise<void> {
  await stopPacServer()

  try {
    triggerAutoProxy(false, '')
    triggerManualProxy(false, '', 0, '')
  } catch (error) {
    await proxyLogger.error('Failed to disable system proxy', error)
    throw error
  }
}

export function disableSysProxySync(): void {
  if (isContainerDeployment()) return // 容器内无系统代理可关，跳过原生调用
  try {
    triggerAutoProxy(false, '')
    triggerManualProxy(false, '', 0, '')
  } catch {
    // ignore errors during sync disable
  }
}
