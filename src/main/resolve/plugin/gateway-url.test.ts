import { describe, it, expect } from 'vitest'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'

describe('parseGatewayOrigin', () => {
  it('accepts a plain https origin and returns it normalized', () => {
    expect(parseGatewayOrigin('https://gw.front.com')).toBe('https://gw.front.com')
    expect(parseGatewayOrigin('https://gw.front.com:8443')).toBe('https://gw.front.com:8443')
    expect(parseGatewayOrigin('https://gw.front.com/')).toBe('https://gw.front.com')
  })
  it('accepts an http origin (LAN IP direct-access build)', () => {
    expect(parseGatewayOrigin('http://gw.front.com')).toBe('http://gw.front.com')
    expect(parseGatewayOrigin('http://192.168.1.100:8080')).toBe('http://192.168.1.100:8080')
  })
  it('rejects non-http(s) schemes', () => {
    expect(parseGatewayOrigin('ftp://gw.front.com')).toBeNull()
    expect(parseGatewayOrigin('ws://gw.front.com')).toBeNull()
  })
  it('rejects path/query/fragment', () => {
    expect(parseGatewayOrigin('https://gw.front.com/base')).toBeNull()
    expect(parseGatewayOrigin('https://gw.front.com/?x=1')).toBeNull()
    expect(parseGatewayOrigin('https://gw.front.com/#f')).toBeNull()
  })
  it('rejects userinfo', () => {
    expect(parseGatewayOrigin('https://u:p@gw.front.com')).toBeNull()
  })
  it('accepts private IP, loopback IP, and localhost names (LAN direct-access build)', () => {
    expect(parseGatewayOrigin('https://127.0.0.1')).toBe('https://127.0.0.1')
    expect(parseGatewayOrigin('http://10.0.0.5:8080')).toBe('http://10.0.0.5:8080')
    expect(parseGatewayOrigin('http://[::1]:8080')).toBe('http://[::1]:8080')
    expect(parseGatewayOrigin('http://localhost:8080')).toBe('http://localhost:8080')
  })
  it('rejects non-string', () => {
    expect(parseGatewayOrigin(123)).toBeNull()
    expect(parseGatewayOrigin(undefined)).toBeNull()
  })
})

describe('isValidEndpointPath', () => {
  it('accepts a relative path starting with /', () => {
    expect(isValidEndpointPath('/config')).toBe(true)
    expect(isValidEndpointPath('/v2/config')).toBe(true)
  })
  it('rejects protocol-relative, absolute, query/fragment, non-string', () => {
    expect(isValidEndpointPath('//evil.example/config')).toBe(false)
    expect(isValidEndpointPath('https://evil.example/config')).toBe(false)
    expect(isValidEndpointPath('/config?x=1')).toBe(false)
    expect(isValidEndpointPath('/config#f')).toBe(false)
    expect(isValidEndpointPath('config')).toBe(false)
    expect(isValidEndpointPath(42)).toBe(false)
  })
  it('rejects backslash host-escape (WHATWG treats \\ as / under https)', () => {
    // new URL('/\\evil.example/config', 'https://gw') === https://evil.example/config
    expect(isValidEndpointPath('/\\evil.example/config')).toBe(false)
    expect(isValidEndpointPath('/\\localhost/config')).toBe(false)
    expect(isValidEndpointPath('/foo\\bar')).toBe(false)
  })
})
