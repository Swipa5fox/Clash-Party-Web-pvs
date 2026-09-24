import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '')
  }
}))

vi.mock('file-icon-info', () => ({ getIcon: vi.fn() }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
let tempDir: string

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-party-icon-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
  vi.restoreAllMocks()
})

describe('getIconDataURL on Windows', () => {
  it('returns otherDevicesIcon for empty path', async () => {
    const { getIconDataURL } = await import('./icon')
    const { otherDevicesIcon } = await import('./defaultIcon')

    expect(await getIconDataURL('')).toBe(otherDevicesIcon)
  })

  it('extracts the icon for exe files via file-icon-info', async () => {
    const { getIcon } = await import('file-icon-info')
    ;(getIcon as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: string, callback: (b64d: string) => void) => {
        callback(Buffer.from('win-icon').toString('base64'))
      }
    )

    const exePath = path.join(tempDir, 'app.exe')
    fs.writeFileSync(exePath, '')

    const { getIconDataURL } = await import('./icon')
    const result = await getIconDataURL(exePath)

    expect(getIcon).toHaveBeenCalledWith(exePath, expect.any(Function))
    expect(result).toBe(`data:image/png;base64,${Buffer.from('win-icon').toString('base64')}`)
  })

  it('falls back to windowsDefaultIcon for non-executable paths', async () => {
    const filePath = path.join(tempDir, 'note.txt')
    fs.writeFileSync(filePath, '')

    const { getIconDataURL } = await import('./icon')
    const { windowsDefaultIcon } = await import('./defaultIcon')

    expect(await getIconDataURL(filePath)).toBe(windowsDefaultIcon)
  })

  it('falls back to linuxDefaultIcon on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })

    const { getIconDataURL } = await import('./icon')
    const { linuxDefaultIcon } = await import('./defaultIcon')

    expect(await getIconDataURL('/usr/bin/whatever')).toBe(linuxDefaultIcon)
  })
})
