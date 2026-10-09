import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'

// 环境变量代理命令文本（原实现位于 resolve/tray.ts，桌面壳删除后迁至通用系统工具）；
// Web 端设置页经 copyEnvText 通道取回文本后由前端写入浏览器剪贴板
export type EnvType = 'bash' | 'cmd' | 'powershell' | 'fish' | 'nushell'

export async function buildEnvText(type?: EnvType): Promise<string> {
  const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const { sysProxy, envType = process.platform === 'win32' ? ['powershell'] : ['bash'] } =
    await getAppConfig()
  const shell = type || envType[0] || 'bash'
  const { host } = sysProxy
  const proxyUrl = `http://${host || '127.0.0.1'}:${mixedPort}`

  switch (shell) {
    case 'bash':
      return `export https_proxy=${proxyUrl} http_proxy=${proxyUrl} all_proxy=${proxyUrl}`
    case 'cmd':
      return `set http_proxy=${proxyUrl}\r\nset https_proxy=${proxyUrl}`
    case 'powershell':
      return `$env:HTTP_PROXY="${proxyUrl}"; $env:HTTPS_PROXY="${proxyUrl}"`
    case 'fish':
      return `set -x http_proxy ${proxyUrl}; set -x https_proxy ${proxyUrl}; set -x all_proxy ${proxyUrl}`
    case 'nushell':
      return `$env.HTTP_PROXY = "${proxyUrl}"; $env.HTTPS_PROXY = "${proxyUrl}"; $env.ALL_PROXY = "${proxyUrl}"`
  }
}
