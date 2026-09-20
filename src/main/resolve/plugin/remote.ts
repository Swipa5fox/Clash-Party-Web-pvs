import { getAppConfig } from '../../config/app'
import { MAX_PLUGIN_FILE_BYTES } from './constants'
import { requestOnce } from './http-client'

// 本改造版允许 http 与任意 host（含内网 IP），以支持内网 IP 直连部署。
function parseDownloadUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid plugin URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Plugin URL must use http(s)')
  }
  if (parsed.username || parsed.password) throw new Error('Plugin URL must not contain userinfo')
  if (parsed.hash) throw new Error('Plugin URL must not contain a fragment')
  return parsed
}

export async function fetchRemotePlugin(url: string): Promise<string> {
  const parsed = parseDownloadUrl(url)
  const { subscriptionTimeout = 30000, pluginUseProxy } = await getAppConfig()
  let proxy: { host: string; port: number } | undefined
  if (pluginUseProxy) {
    const { getControledMihomoConfig } = await import('../../config/controledMihomo')
    const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
    proxy = { host: '127.0.0.1', port }
  }

  const response = await requestOnce(parsed.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json, application/octet-stream' },
    timeout: subscriptionTimeout,
    maxBytes: MAX_PLUGIN_FILE_BYTES,
    proxy
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Plugin download failed (status ${response.status})`)
  }
  return Buffer.from(response.body, 'utf-8').toString('base64')
}
