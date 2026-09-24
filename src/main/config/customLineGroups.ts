import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { customLineGroupsConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'

let customLineGroupsConfig: ICustomLineGroupsConfig
const customLineGroupsWriteQueue = new WriteQueue()

export async function getCustomLineGroupsConfig(force = false): Promise<ICustomLineGroupsConfig> {
  if (force || !customLineGroupsConfig) {
    if (existsSync(customLineGroupsConfigPath())) {
      const data = await readFile(customLineGroupsConfigPath(), 'utf-8')
      customLineGroupsConfig = parse(data) || { items: [] }
    } else {
      customLineGroupsConfig = { items: [] }
    }
  }
  if (typeof customLineGroupsConfig !== 'object') customLineGroupsConfig = { items: [] }
  if (!Array.isArray(customLineGroupsConfig.items)) customLineGroupsConfig.items = []
  return JSON.parse(JSON.stringify(customLineGroupsConfig)) as ICustomLineGroupsConfig
}

export async function setCustomLineGroupsConfig(config: ICustomLineGroupsConfig): Promise<void> {
  await customLineGroupsWriteQueue.run(async () => {
    const nextConfig = JSON.parse(JSON.stringify(config)) as ICustomLineGroupsConfig
    if (!Array.isArray(nextConfig.items)) nextConfig.items = []
    nextConfig.items.forEach((item) => {
      if (!Array.isArray(item.proxies)) item.proxies = []
      item.port = Number(item.port) || 0
    })
    await atomicWriteFile(customLineGroupsConfigPath(), stringify(nextConfig), {
      encoding: 'utf8'
    })
    customLineGroupsConfig = nextConfig
  })
}
