import { getPlatform, getVersion } from './ipc'

export let platform: NodeJS.Platform
export let version: string

export async function init(): Promise<void> {
  platform = await getPlatform()
  version = await getVersion()
}
