import { getPlatform, getVersion } from './ipc'

// web 端（浏览器 shim）标记：window.electron.isWeb 仅在 web shim 下存在，Electron preload 无此属性
export const isWeb = (window.electron as { isWeb?: boolean } | undefined)?.isWeb === true

export let platform: NodeJS.Platform
export let version: string

export async function init(): Promise<void> {
  platform = await getPlatform()
  version = await getVersion()
}
