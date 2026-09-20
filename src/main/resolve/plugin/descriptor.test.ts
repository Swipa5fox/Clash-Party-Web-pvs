import { describe, it, expect } from 'vitest'
import { parseDescriptor } from './descriptor'

const PNG = 'data:image/png;base64,iVBOR'
function file(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    magic: 'CPXF',
    v: 2,
    spec: 'cpx-plugin/2',
    loginUrl: 'https://panel.xx.com/oauth/authorize',
    provider: { name: 'XX', icon: PNG, site: 'https://xx.com' },
    ...over
  })
}

describe('parseDescriptor', () => {
  it('accepts a valid descriptor', () => {
    const d = parseDescriptor(file())
    expect(d.loginUrl).toBe('https://panel.xx.com/oauth/authorize')
    expect(d.provider.name).toBe('XX')
  })
  it('accepts an http loginUrl (LAN IP direct-access build)', () => {
    const d = parseDescriptor(file({ loginUrl: 'http://192.168.1.100:8080/oauth/authorize' }))
    expect(d.loginUrl).toBe('http://192.168.1.100:8080/oauth/authorize')
  })
  it('rejects a non-http(s) loginUrl', () => {
    expect(() => parseDescriptor(file({ loginUrl: 'ftp://panel.xx.com/a' }))).toThrow()
  })
  it('rejects loginUrl with query', () => {
    expect(() => parseDescriptor(file({ loginUrl: 'https://panel.xx.com/a?x=1' }))).toThrow()
  })
  it('rejects loginUrl with fragment', () => {
    expect(() => parseDescriptor(file({ loginUrl: 'https://panel.xx.com/a#f' }))).toThrow()
  })
  it('accepts loginUrl with a loopback/private/localhost host (direct-access build)', () => {
    expect(() => parseDescriptor(file({ loginUrl: 'http://127.0.0.1:8080/oauth' }))).not.toThrow()
    expect(() => parseDescriptor(file({ loginUrl: 'http://10.0.0.5:8080/oauth' }))).not.toThrow()
    expect(() => parseDescriptor(file({ loginUrl: 'http://[::1]:8080/oauth' }))).not.toThrow()
    expect(() => parseDescriptor(file({ loginUrl: 'http://localhost:8080/oauth' }))).not.toThrow()
  })
  it('rejects loginUrl with userinfo', () => {
    expect(() => parseDescriptor(file({ loginUrl: 'https://u:p@panel.xx.com/oauth' }))).toThrow()
  })
  it('accepts a private IP literal in provider.site (direct-access build)', () => {
    expect(() =>
      parseDescriptor(file({ provider: { name: 'X', site: 'http://192.168.1.1:8080' } }))
    ).not.toThrow()
  })
  it('rejects unknown top-level fields', () => {
    expect(() => parseDescriptor(file({ extra: 1 }))).toThrow()
  })
  it('rejects svg icon', () => {
    expect(() =>
      parseDescriptor(file({ provider: { name: 'X', icon: 'data:image/svg+xml,<svg/>' } }))
    ).toThrow()
  })
  it('rejects external icon url', () => {
    expect(() =>
      parseDescriptor(file({ provider: { name: 'X', icon: 'https://x.com/a.png' } }))
    ).toThrow()
  })
  it('rejects oversized icon', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(64 * 1024 + 1)
    expect(() => parseDescriptor(file({ provider: { name: 'X', icon: big } }))).toThrow()
  })
  it('rejects a non-http(s) site', () => {
    expect(() => parseDescriptor(file({ provider: { name: 'X', site: 'ftp://xx.com' } }))).toThrow()
  })
  it('rejects wrong spec', () => {
    expect(() => parseDescriptor(file({ spec: 'cpx-plugin/1' }))).toThrow()
  })
  it('gives a specific error for a v1 file', () => {
    expect(() => parseDescriptor(JSON.stringify({ magic: 'CPXF', v: 1 }))).toThrow(/v1/)
  })
  it('rejects invalid JSON', () => {
    expect(() => parseDescriptor('{not json')).toThrow()
  })
  it('rejects non-object JSON (e.g. a string)', () => {
    expect(() => parseDescriptor('"just a string"')).toThrow()
  })
  it('rejects wrong magic', () => {
    expect(() => parseDescriptor(file({ magic: 'OOPS' }))).toThrow()
  })
  it('rejects unknown provider fields', () => {
    expect(() => parseDescriptor(file({ provider: { name: 'X', extra: 1 } }))).toThrow()
  })
  it('rejects missing/empty provider.name', () => {
    expect(() => parseDescriptor(file({ provider: { name: '' } }))).toThrow()
  })
})
