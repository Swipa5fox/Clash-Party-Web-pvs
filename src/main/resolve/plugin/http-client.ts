import http from 'http'
import https from 'https'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

export interface PluginRequestOptions {
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeout: number
  maxBytes: number
  proxy?: { host: string; port: number }
}

export interface PluginResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding'])
const MAX_HEADERS = 32
const MAX_HEADER_NAME_LEN = 128
const MAX_HEADER_VALUE_LEN = 4096
const MAX_HEADER_BYTES = 16 * 1024

function validateHeaders(input: Record<string, string>): Record<string, string> {
  const entries = Object.entries(input)
  if (entries.length > MAX_HEADERS) throw new Error('Request headers too large')

  const headers: Record<string, string> = {}
  let total = 0
  for (const [k, v] of entries) {
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) {
      throw new Error(`Forbidden header: ${k}`)
    }
    const nameBytes = Buffer.byteLength(k, 'utf-8')
    const valueBytes = Buffer.byteLength(v, 'utf-8')
    if (nameBytes > MAX_HEADER_NAME_LEN || valueBytes > MAX_HEADER_VALUE_LEN) {
      throw new Error('Request headers too large')
    }
    total += nameBytes + valueBytes
    headers[k] = v
  }
  if (total > MAX_HEADER_BYTES) throw new Error('Request headers too large')
  return headers
}

export function requestOnce(urlStr: string, opts: PluginRequestOptions): Promise<PluginResponse> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(urlStr)
    } catch {
      reject(new Error('Invalid URL'))
      return
    }
    const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null
    if (!mod) {
      reject(new Error(`Unsupported protocol: ${url.protocol}`))
      return
    }
    let headers: Record<string, string>
    try {
      headers = validateHeaders(opts.headers ?? {})
    } catch (e) {
      reject(e)
      return
    }
    if (opts.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(opts.body))

    // 代理模式：连接打到本地代理，目标由代理解析
    const proxyUrl = opts.proxy ? `http://${opts.proxy.host}:${opts.proxy.port}` : undefined
    const agent = proxyUrl
      ? url.protocol === 'https:'
        ? new HttpsProxyAgent(proxyUrl)
        : new HttpProxyAgent(proxyUrl)
      : undefined

    const req = mod.request(
      url,
      {
        method: opts.method,
        headers,
        agent,
        timeout: opts.timeout
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.destroy()
          reject(new Error(`Refusing to follow redirect (status ${status})`))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > opts.maxBytes) {
            res.destroy()
            reject(new Error('Response too large'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () =>
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') })
        )
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}
