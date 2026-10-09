import { readFile } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'
import {
  normalizeMaxLogFileSizeMB,
  setCoreLogDisabled,
  setGlobalMaxLogFileSizeMB
} from '../utils/logFile'
import { setLogIngestLimits } from '../db/logIngest'
import { setAppLogDisabled } from '../utils/logger'

let appConfig: IAppConfig // config.yaml

// PG 日志设置归一：保留天数 [1,365]，行数上限 [1000, 10_000_000]
export function normalizeRetentionDays(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 7
  return Math.min(365, Math.max(1, Math.floor(num)))
}

export function normalizeMaxRows(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 500_000
  return Math.min(10_000_000, Math.max(1_000, Math.floor(num)))
}
const appConfigWriteQueue = new WriteQueue()

function cloneDefaultConfig(): IAppConfig {
  return structuredClone(defaultConfig)
}

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    await appConfigWriteQueue.run(async () => {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsedConfig = parse(data)
      const mergedConfig = deepMerge(cloneDefaultConfig(), parsedConfig || {})
      mergedConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      if (JSON.stringify(mergedConfig) !== JSON.stringify(parsedConfig)) {
        await atomicWriteFile(appConfigPath(), stringify(mergedConfig))
      }
      setGlobalMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      setCoreLogDisabled(mergedConfig.disableCoreLog === true)
      setAppLogDisabled(mergedConfig.disableAppLog === true)
      setLogIngestLimits(
        normalizeRetentionDays(mergedConfig.pgLogRetentionDays),
        normalizeMaxRows(mergedConfig.pgLogMaxRows)
      )
      appConfig = mergedConfig
    })
  }
  if (typeof appConfig !== 'object') appConfig = cloneDefaultConfig()
  return appConfig
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  await appConfigWriteQueue.run(async () => {
    const replaceNameserverPolicy = Object.prototype.hasOwnProperty.call(patch, 'nameserverPolicy')
    const nextConfig = deepMerge(structuredClone(appConfig ?? cloneDefaultConfig()), patch)
    if (replaceNameserverPolicy) {
      nextConfig.nameserverPolicy = patch.nameserverPolicy ?? {}
    }
    nextConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(nextConfig.maxLogFileSize)
    await atomicWriteFile(appConfigPath(), stringify(nextConfig))
    appConfig = nextConfig
    setGlobalMaxLogFileSizeMB(nextConfig.maxLogFileSize)
    setCoreLogDisabled(nextConfig.disableCoreLog === true)
    setAppLogDisabled(nextConfig.disableAppLog === true)
    setLogIngestLimits(
      normalizeRetentionDays(nextConfig.pgLogRetentionDays),
      normalizeMaxRows(nextConfig.pgLogMaxRows)
    )
  })
}
