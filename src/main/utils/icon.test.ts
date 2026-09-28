import { describe, expect, it } from 'vitest'
import { getIconDataURL } from './icon'
import { linuxDefaultIcon, otherDevicesIcon } from './defaultIcon'

// 服务器形态下无 Electron app.getFileIcon：所有路径回退默认图标。
describe('getIconDataURL', () => {
  it('returns otherDevicesIcon for empty path', async () => {
    expect(await getIconDataURL('')).toBe(otherDevicesIcon)
  })

  it('returns linuxDefaultIcon for any path', async () => {
    expect(await getIconDataURL('/usr/bin/whatever')).toBe(linuxDefaultIcon)
    expect(await getIconDataURL('C:\\Program Files\\app.exe')).toBe(linuxDefaultIcon)
  })
})
