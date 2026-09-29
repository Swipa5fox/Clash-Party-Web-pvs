import axios from 'axios'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Buffer
  proxy?: { host: string; port: number } | false
  timeout?: number
  responseType?: 'text' | 'json' | 'arraybuffer'
}

export interface Response<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

/**
 * HTTP 请求（原 Electron net.request 的纯 Node 替代，axios + proxy-agent）。
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<Response<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    proxy,
    timeout = 30000,
    responseType = 'text'
  } = options

  let httpAgent: HttpProxyAgent<string> | undefined
  let httpsAgent: HttpsProxyAgent<string> | undefined
  if (proxy) {
    const proxyUrl = `http://${proxy.host}:${proxy.port}`
    httpAgent = new HttpProxyAgent(proxyUrl)
    httpsAgent = new HttpsProxyAgent(proxyUrl)
  }

  const res = await axios.request({
    method,
    url,
    headers,
    data: body,
    timeout,
    responseType:
      responseType === 'json' ? 'json' : responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    // 保持原语义：非 2xx 不抛错（原 net.request 也不会），由调用方检查 status。
    validateStatus: () => true,
    transformResponse: [(data) => data],
    httpAgent,
    httpsAgent,
    signal: AbortSignal.timeout(timeout)
  })

  const responseHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(res.headers)) {
    responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }

  let data: unknown
  if (responseType === 'json') {
    if (typeof res.data === 'string') {
      data = JSON.parse(res.data)
    } else if (Buffer.isBuffer(res.data)) {
      data = JSON.parse(res.data.toString('utf-8'))
    } else {
      data = res.data
    }
  } else {
    data = res.data
  }

  return {
    data: data as T,
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
    url: res.config.url ?? url
  }
}

/**
 * Convenience method for GET requests
 */
export const get = <T = unknown>(
  url: string,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => request<T>(url, { ...options, method: 'GET' })

/**
 * Convenience method for POST requests
 */
export const post = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'POST', body, headers })
}

/**
 * Convenience method for PATCH requests
 */
export const patch = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'PATCH', body, headers })
}
