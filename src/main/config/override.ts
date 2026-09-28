import { readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { overrideConfigPath, overridePath } from '../utils/dirs'
import * as chromeRequest from '../utils/chromeRequest'
import { parse, stringify } from '../utils/yaml'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { getControledMihomoConfig } from './controledMihomo'

let overrideConfig: IOverrideConfig // override.yaml
const overrideConfigWriteQueue = new WriteQueue()

export async function getOverrideConfig(force = false): Promise<IOverrideConfig> {
  if (force || !overrideConfig) {
    const data = await readFile(overrideConfigPath(), 'utf-8')
    overrideConfig = parse(data) || { items: [] }
  }
  if (typeof overrideConfig !== 'object') overrideConfig = { items: [] }
  if (!Array.isArray(overrideConfig.items)) overrideConfig.items = []
  return structuredClone(overrideConfig)
}

export async function setOverrideConfig(config: IOverrideConfig): Promise<void> {
  await overrideConfigWriteQueue.run(async () => {
    const nextConfig = structuredClone(config)
    await atomicWriteFile(overrideConfigPath(), stringify(nextConfig), { encoding: 'utf8' })
    overrideConfig = nextConfig
  })
}

export async function getOverrideItem(id: string | undefined): Promise<IOverrideItem | undefined> {
  const { items } = await getOverrideConfig()
  return items.find((item) => item.id === id)
}

export async function updateOverrideItem(item: IOverrideItem): Promise<void> {
  const config = await getOverrideConfig()
  const index = config.items.findIndex((i) => i.id === item.id)
  if (index === -1) {
    throw new Error('Override not found')
  }
  config.items[index] = item
  await setOverrideConfig(config)
}

export async function addOverrideItem(item: Partial<IOverrideItem>): Promise<void> {
  const config = await getOverrideConfig()
  const newItem = await createOverride(item)
  if (await getOverrideItem(item.id)) {
    await updateOverrideItem(newItem)
  } else {
    config.items.push(newItem)
    await setOverrideConfig(config)
  }
}

export async function removeOverrideItem(id: string): Promise<void> {
  const config = await getOverrideConfig()
  const item = await getOverrideItem(id)
  if (!item) return
  config.items = config.items?.filter((i) => i.id !== id)
  await setOverrideConfig(config)
  if (existsSync(overridePath(id, item.ext))) {
    await rm(overridePath(id, item.ext))
  }
}

export async function createOverride(item: Partial<IOverrideItem>): Promise<IOverrideItem> {
  const id = item.id || new Date().getTime().toString(16)
  const newItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type,
    // remote 未显式指定 ext 时按 URL 后缀推断, 否则 .yaml 覆写会被当 JS 沙箱执行
    ext: item.ext || (item.type === 'remote' && /\.ya?ml$/i.test(item.url || '') ? 'yaml' : 'js'),
    url: item.url,
    global: item.global || false,
    updated: new Date().getTime()
  } as IOverrideItem
  switch (newItem.type) {
    case 'remote': {
      const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } =
        await getControledMihomoConfig()
      if (!item.url) throw new Error('Empty URL')
      const res = await chromeRequest.get(item.url, {
        proxy: {
          protocol: 'http',
          host: '127.0.0.1',
          port: mixedPort
        },
        responseType: 'text'
      })
      // chromeRequest 保持 net.request 语义: 非 2xx 不抛错, 这里必须自检, 否则 404 页面会被当成覆写内容落盘
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = res.data as string
      await setOverride(id, newItem.ext, data)
      break
    }
    case 'local': {
      const data = item.file || ''
      await setOverride(id, newItem.ext, data)
      break
    }
  }

  return newItem
}

export async function getOverride(id: string, ext: 'js' | 'yaml' | 'log'): Promise<string> {
  if (!existsSync(overridePath(id, ext))) {
    return ''
  }
  return await readFile(overridePath(id, ext), 'utf-8')
}

export async function setOverride(id: string, ext: 'js' | 'yaml', content: string): Promise<void> {
  await atomicWriteFile(overridePath(id, ext), content, { encoding: 'utf8' })
}
