import { exec } from 'child_process'
import { promisify } from 'util'
import { nativeTheme } from 'electron'
import { exePath, mihomoCorePath } from '../utils/dirs'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'

export async function setupFirewall(): Promise<void> {
  const execPromise = promisify(exec)

  if (process.platform === 'win32') {
    const rules = [
      { name: 'mihomo', program: mihomoCorePath('mihomo') },
      { name: 'mihomo-alpha', program: mihomoCorePath('mihomo-alpha') },
      { name: 'Mihomo Party', program: exePath() }
    ]
    for (const rule of rules) {
      await execPromise(`netsh advfirewall firewall delete rule name="${rule.name}"`, {
        shell: 'cmd'
      }).catch(() => {})
      await execPromise(
        `netsh advfirewall firewall add rule name="${rule.name}" dir=in action=allow program="${rule.program}" enable=yes profile=any`,
        { shell: 'cmd' }
      )
    }
  }
}

export function setNativeTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}

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
