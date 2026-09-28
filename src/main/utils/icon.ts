import { linuxDefaultIcon, otherDevicesIcon } from './defaultIcon'

// Web-Only：连接页进程图标仅 Windows 有取图标能力；
// 纯 Node 服务器上无桌面环境可查，全部回退默认图标。
export async function getIconDataURL(appPath: string): Promise<string> {
  if (!appPath) {
    return otherDevicesIcon
  }
  return linuxDefaultIcon
}
