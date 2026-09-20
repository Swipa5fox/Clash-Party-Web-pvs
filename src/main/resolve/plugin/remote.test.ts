import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PLUGIN_FILE_BYTES } from './constants'
import { fetchRemotePlugin } from './remote'
const getAppConfig = vi.fn()
const getControledMihomoConfig = vi.fn()
const requestOnce = vi.fn()

vi.mock('../../config/app', () => ({
  getAppConfig: (...args: unknown[]) => getAppConfig(...args)
}))
vi.mock('../../config/controledMihomo', () => ({
  getControledMihomoConfig: (...args: unknown[]) => getControledMihomoConfig(...args)
}))
vi.mock('./http-client', () => ({
  requestOnce: (...args: unknown[]) => requestOnce(...args)
}))

beforeEach(() => {
  getAppConfig.mockReset().mockResolvedValue({ subscriptionTimeout: 1234 })
  getControledMihomoConfig.mockReset().mockResolvedValue({ 'mixed-port': 17890 })
  requestOnce.mockReset().mockResolvedValue({ status: 200, headers: {}, body: '{"magic":"CPXF"}' })
})

describe('fetchRemotePlugin', () => {
  it('downloads an https descriptor with the plugin client', async () => {
    const result = await fetchRemotePlugin('https://provider.example/app.cpx?channel=stable')

    expect(Buffer.from(result, 'base64').toString('utf-8')).toBe('{"magic":"CPXF"}')
    expect(requestOnce).toHaveBeenCalledWith(
      'https://provider.example/app.cpx?channel=stable',
      expect.objectContaining({
        method: 'GET',
        timeout: 1234,
        maxBytes: MAX_PLUGIN_FILE_BYTES,
        proxy: undefined
      })
    )
  })

  it('downloads an http descriptor from a LAN address (direct-access build)', async () => {
    await fetchRemotePlugin('http://192.168.1.100:8080/app.cpx')
    expect(requestOnce).toHaveBeenCalledWith(
      'http://192.168.1.100:8080/app.cpx',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('uses the configured local proxy when enabled', async () => {
    getAppConfig.mockResolvedValue({ subscriptionTimeout: 5000, pluginUseProxy: true })
    await fetchRemotePlugin('https://provider.example/app.cpx')
    expect(requestOnce.mock.calls[0][1].proxy).toEqual({ host: '127.0.0.1', port: 17890 })
  })

  it.each([
    'ftp://provider.example/app.cpx',
    'https://user:password@provider.example/app.cpx',
    'https://provider.example/app.cpx#fragment'
  ])('rejects an unsafe download URL: %s', async (url) => {
    await expect(fetchRemotePlugin(url)).rejects.toThrow()
    expect(requestOnce).not.toHaveBeenCalled()
  })

  it('rejects non-success responses', async () => {
    requestOnce.mockResolvedValue({ status: 404, headers: {}, body: 'not found' })
    await expect(fetchRemotePlugin('https://provider.example/app.cpx')).rejects.toThrow(/404/)
  })

  it('propagates the network size guard', async () => {
    requestOnce.mockRejectedValue(new Error('Response too large'))
    await expect(fetchRemotePlugin('https://provider.example/app.cpx')).rejects.toThrow(
      /too large/i
    )
  })
})
