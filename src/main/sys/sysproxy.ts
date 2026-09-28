import { existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { proxyLogger } from '../utils/logger'
import { isContainerDeployment } from '../utils/deployment'
import { resourcesDir } from '../utils/dirs'

// sysproxy-rs 仅在 Windows 有意义（Linux 服务器上没有桌面代理设置可写），
// 且原生模块按平台分发。依赖包已随桌面化清除，改为直接加载
// extra/sidecar 下的 win32 原生绑定（与 mihomo 内核同目录布局）。
type SysproxyBinding = {
  triggerAutoProxy: (enable: boolean, url: string) => void
  triggerManualProxy: (enable: boolean, host: string, port: number, bypass: string) => void
}

let bindingPromise: Promise<SysproxyBinding | null> | null = null

function loadBinding(): Promise<SysproxyBinding | null> {
  if (!bindingPromise) {
    bindingPromise =
      process.platform === 'win32'
        ? Promise.resolve().then(() => {
            const bindingPath = join(resourcesDir(), 'sidecar', 'sysproxy.win32-x64-msvc.node')
            if (!existsSync(bindingPath)) return null
            // 不用 import.meta.url：esbuild 的 cjs 产物里它为空(undefined)。
            // 绑定路径是绝对路径，createRequire 的基址不影响解析。
            const native = createRequire(process.execPath)(bindingPath) as SysproxyBinding
            if (typeof native.triggerAutoProxy !== 'function') return null
            return native
          })
        : Promise.resolve(null)
  }
  return bindingPromise
}

let triggerSysProxyQueue: Promise<void> = Promise.resolve()

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

export async function triggerSysProxy(enable: boolean): Promise<void> {
  // 容器部署（clash-party 镜像）内没有宿主机桌面环境，sysproxy-rs 的原生调用
  // 必然失败（如 Linux 上找不到 gsettings → "No such file or directory"）。
  // 在这里给出明确错误，让前端 toast 显示可操作的提示而非底层 os error。
  if (isContainerDeployment()) {
    throw new Error('容器部署不支持系统代理：请让各设备手动配置代理地址 http://<主机IP>:7890')
  }
  // Linux 服务器上无系统代理可写（无桌面环境），PAC 服务照常启停但原生调用跳过。
  if (process.platform !== 'win32') {
    if (enable) {
      await startPacServer()
    } else {
      await stopPacServer()
    }
    return
  }

  // 原 Electron net.isOnline() 网络离线重试路径：服务器恒在线，直接顺序执行。
  const operation = triggerSysProxyQueue.then(async () => {
    if (enable) {
      await disableSysProxy()
      await enableSysProxy()
    } else {
      await disableSysProxy()
    }
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

  const binding = await loadBinding()
  if (!binding) return

  try {
    if (mode === 'auto') {
      binding.triggerAutoProxy(true, `http://${proxyHost}:${pacPort}/pac`)
    } else {
      binding.triggerManualProxy(true, proxyHost, port, formattedBypass)
    }
  } catch (error) {
    await proxyLogger.error('Failed to enable system proxy', error)
    throw error
  }
}

async function disableSysProxy(): Promise<void> {
  await stopPacServer()

  const binding = await loadBinding()
  if (!binding) return

  try {
    binding.triggerAutoProxy(false, '')
    binding.triggerManualProxy(false, '', 0, '')
  } catch (error) {
    await proxyLogger.error('Failed to disable system proxy', error)
    throw error
  }
}

export async function disableSysProxySync(): Promise<void> {
  if (isContainerDeployment()) return // 容器内无系统代理可关，跳过原生调用
  if (process.platform !== 'win32') return
  const binding = await loadBinding()
  if (!binding) return
  try {
    binding.triggerAutoProxy(false, '')
    binding.triggerManualProxy(false, '', 0, '')
  } catch {
    // ignore errors during sync disable
  }
}
