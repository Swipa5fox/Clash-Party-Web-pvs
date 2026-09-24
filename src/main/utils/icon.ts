import { exec } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { getIcon } from 'file-icon-info'
import { app } from 'electron'
import { windowsDefaultIcon, linuxDefaultIcon, otherDevicesIcon } from './defaultIcon'

// Web-Only：连接页进程图标仅 Windows 有取图标能力（file-icon-info）；
// 其余平台（容器 Linux）无桌面环境可查，直接回退默认图标。
export async function getIconDataURL(appPath: string): Promise<string> {
  if (!appPath) {
    return otherDevicesIcon
  }
  if (appPath === 'mihomo') {
    appPath = app.getPath('exe')
  }

  if (process.platform !== 'win32') {
    return linuxDefaultIcon
  }

  if (fs.existsSync(appPath) && /\.(exe|dll)$/i.test(appPath)) {
    try {
      let targetPath = appPath
      let tempLinkPath: string | null = null

      if (/[\u4e00-\u9fff]/.test(appPath)) {
        const tempDir = os.tmpdir()
        const randomName = crypto.randomBytes(8).toString('hex')
        const fileExt = path.extname(appPath)
        tempLinkPath = path.join(tempDir, `${randomName}${fileExt}`)

        try {
          await new Promise<void>((resolve) => {
            exec(`mklink "${tempLinkPath}" "${appPath}"`, (error) => {
              if (!error && tempLinkPath && fs.existsSync(tempLinkPath)) {
                targetPath = tempLinkPath
              }
              resolve()
            })
          })
        } catch {
          // ignore mklink errors
        }
      }

      try {
        const iconBuffer = await new Promise<Buffer>((resolve, reject) => {
          getIcon(targetPath, (b64d) => {
            try {
              resolve(Buffer.from(b64d, 'base64'))
            } catch (error) {
              reject(error)
            }
          })
        })

        return `data:image/png;base64,${iconBuffer.toString('base64')}`
      } finally {
        if (tempLinkPath && fs.existsSync(tempLinkPath)) {
          try {
            fs.unlinkSync(tempLinkPath)
          } catch {
            // ignore cleanup errors
          }
        }
      }
    } catch {
      return windowsDefaultIcon
    }
  } else {
    return windowsDefaultIcon
  }
}
