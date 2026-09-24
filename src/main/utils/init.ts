import { mkdir, rm, readdir, cp, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { app, dialog } from 'electron'
import { startPacServer } from '../resolve/server'
import { startFileShareServer } from '../resolve/fileShare'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { startSSIDCheck } from '../sys/ssid'
import i18next, { resources } from '../../shared/i18n'
import {
  DEFAULT_MIHOMO_LAN_ALLOWED_IPS,
  DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES,
  getDefaultMihomoTunDevice
} from '../../shared/appConfig'
import { stringify } from './yaml'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultOverrideConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  fileShareDir,
  logDir,
  mihomoTestDir,
  mihomoWorkDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  rulesDir,
  themesDir
} from './dirs'
import { initLogger } from './logger'
import { atomicWriteFile } from './safeFile'

let isInitBasicCompleted = false
let isRuntimeFilesCompleted = false
let initBasicPromise: Promise<void> | null = null
let runtimeFilesPromise: Promise<void> | null = null

// Web UI 模式判定与 index.ts 保持一致：宿主无窗口时 dialog.showErrorBox 的模态框会冻结桥连接。
const webMode = process.argv.includes('--web') || !!process.env.CP_WEB_MODE

export function safeShowErrorBox(titleKey: string, message: string): void {
  let title: string
  try {
    title = i18next.t(titleKey)
    if (!title || title === titleKey) throw new Error('Translation not ready')
  } catch {
    const isZh = app.getLocale().startsWith('zh')
    const lang = isZh ? resources['zh-CN'].translation : resources['en-US'].translation
    title = lang[titleKey] || (isZh ? '错误' : 'Error')
  }
  if (webMode) {
    // web 模式：降级为日志（渲染层已有 toast/错误边界），避免宿主模态框冻结事件循环。
    void initLogger.error(`[web] error box suppressed: ${title}`, message)
    return
  }
  dialog.showErrorBox(title, message)
}

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

async function initDirs(): Promise<void> {
  const dirsToCreate = [
    dataDir(),
    themesDir(),
    profilesDir(),
    overrideDir(),
    rulesDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir(),
    fileShareDir()
  ]

  await Promise.all(
    dirsToCreate.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configs = [
    { path: appConfigPath(), content: defaultConfig, name: 'app config' },
    { path: profileConfigPath(), content: defaultProfileConfig, name: 'profile config' },
    { path: overrideConfigPath(), content: defaultOverrideConfig, name: 'override config' },
    { path: profilePath('default'), content: defaultProfile, name: 'default profile' },
    {
      path: controledMihomoConfigPath(),
      content: defaultControledMihomoConfig,
      name: 'mihomo config'
    }
  ]

  await Promise.all(
    configs.map(async (config) => {
      if (!existsSync(config.path)) {
        await atomicWriteFile(config.path, stringify(config.content))
      }
    })
  )
}

async function killOldMihomoProcesses(): Promise<void> {
  if (process.platform !== 'win32') return

  try {
    const execFilePromise = promisify(execFile)
    const coreNames = new Set(['mihomo.exe', 'mihomo-alpha.exe', 'mihomo-smart.exe'])
    const { stdout } = await execFilePromise('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024
    })

    const pids = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes('INFO:'))
      .map((line) => {
        const [, imageName, pid] = line.match(/^"([^"]+)","(\d+)"/) || []
        if (!imageName || !coreNames.has(imageName.toLowerCase())) return NaN
        return parseInt(pid, 10)
      })
      .filter((pid) => !isNaN(pid) && pid !== process.pid)

    if (pids.length === 0) return

    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
        await initLogger.info(`Terminated old mihomo process ${pid}`)
      } catch {
        // 进程可能退出
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  } catch {
    // 忽略错误
  }
}

async function initFiles(): Promise<void> {
  await killOldMihomoProcesses()

  const copyFile = async (file: string, targetDirs: string[]): Promise<void> => {
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(sourcePath)) return

    const targets = targetDirs.map((dir) => path.join(dir, file))

    await Promise.all(
      targets.map(async (targetPath) => {
        const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
        if (!shouldCopy) return

        try {
          await cp(sourcePath, targetPath, { recursive: true, force: true })
        } catch (error: unknown) {
          const code = (error as NodeJS.ErrnoException).code
          // 文件被占用或权限问题，如果目标已存在则跳过
          if (
            (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') &&
            existsSync(targetPath)
          ) {
            await initLogger.warn(`Skipping ${file}: file is in use or permission denied`)
            return
          }
          throw error
        }
      })
    )
  }

  const files = [
    {
      name: 'country.mmdb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geoip.metadb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geoip.dat',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geosite.dat',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'ASN.mmdb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'BundleMRS.7z',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    }
  ]

  const criticalFiles = ['country.mmdb', 'geoip.dat', 'geosite.dat']

  const results = await Promise.allSettled(
    files.map(({ name, targetDirs }) => copyFile(name, targetDirs))
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const file = files[i].name
      await initLogger.error(`Failed to copy ${file}`, result.reason)
      if (criticalFiles.includes(file)) {
        throw new Error(`Failed to copy critical file ${file}: ${result.reason}`)
      }
    }
  }
}

async function cleanup(): Promise<void> {
  const [dataFiles, logFiles] = await Promise.all([readdir(dataDir()), readdir(logDir())])

  // 清理更新缓存
  const cacheExtensions = ['.exe', '.pkg', '.7z']
  const cacheCleanup = dataFiles
    .filter((file) => cacheExtensions.some((ext) => file.endsWith(ext)))
    .map((file) => rm(path.join(dataDir(), file)).catch(() => {}))

  // 清理过期日志
  const { maxLogDays = 7 } = await getAppConfig()
  const maxAge = maxLogDays * 24 * 60 * 60 * 1000
  const datePattern = /\d{4}-\d{2}-\d{2}/

  const logCleanup = logFiles
    .filter((log) => {
      const match = log.match(datePattern)
      if (!match) return false
      const date = new Date(match[0])
      return !isNaN(date.getTime()) && Date.now() - date.getTime() > maxAge
    })
    .map((log) => rm(path.join(logDir(), log)).catch(() => {}))

  await Promise.all([...cacheCleanup, ...logCleanup])
}

// 迁移：修复 appTheme
async function migrateAppTheme(): Promise<void> {
  const { appTheme = 'system' } = await getAppConfig()
  if (!['system', 'light', 'dark'].includes(appTheme)) {
    await patchAppConfig({ appTheme: 'system' })
  }
}

// 迁移：envType 字符串转数组
async function migrateEnvType(): Promise<void> {
  const { envType } = await getAppConfig()
  if (typeof envType === 'string') {
    await patchAppConfig({ envType: [envType] })
  }
}

async function migration(): Promise<void> {
  await Promise.all([
    migrateAppTheme(),
    migrateEnvType(),
    migrateRemovePassword(),
    migrateMihomoConfig()
  ])
}

// 迁移：移除加密密码
async function migrateRemovePassword(): Promise<void> {
  const { encryptedPassword } = await getAppConfig()
  if (encryptedPassword) {
    await patchAppConfig({ encryptedPassword: undefined })
  }
}

// 迁移：mihomo 配置默认值
async function migrateMihomoConfig(): Promise<void> {
  const config = await getControledMihomoConfig()
  const patches: Partial<IMihomoConfig> = {}

  // skip-auth-prefixes
  if (!config['skip-auth-prefixes']) {
    patches['skip-auth-prefixes'] = [...DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES]
  } else if (
    config['skip-auth-prefixes'].length >= 1 &&
    config['skip-auth-prefixes'][0] === DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES[0] &&
    !config['skip-auth-prefixes'].includes(DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES[1])
  ) {
    patches['skip-auth-prefixes'] = [
      ...DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES,
      ...config['skip-auth-prefixes'].slice(1)
    ]
  }

  // 其他默认值
  if (!config.authentication) patches.authentication = []
  if (!config['bind-address']) patches['bind-address'] = '*'
  if (!config['lan-allowed-ips']) patches['lan-allowed-ips'] = [...DEFAULT_MIHOMO_LAN_ALLOWED_IPS]
  if (!config['lan-disallowed-ips']) patches['lan-disallowed-ips'] = []

  // tun device
  if (!config.tun?.device) {
    patches.tun = {
      ...config.tun,
      device: getDefaultMihomoTunDevice()
    }
  }

  // 移除废弃配置
  if (config['external-controller-unix']) patches['external-controller-unix'] = undefined
  if (config['external-controller-pipe']) patches['external-controller-pipe'] = undefined
  if (config['external-controller'] === undefined) patches['external-controller'] = ''

  if (Object.keys(patches).length > 0) {
    await patchControledMihomoConfig(patches)
  }
}

export async function initBasic(): Promise<void> {
  if (isInitBasicCompleted) return
  if (initBasicPromise) return initBasicPromise

  initBasicPromise = (async () => {
    await initDirs()
    await initConfig()
    await migration()

    isInitBasicCompleted = true
  })()

  try {
    await initBasicPromise
  } finally {
    initBasicPromise = null
  }
}

export async function ensureRuntimeFiles(): Promise<void> {
  if (isRuntimeFilesCompleted) return
  if (runtimeFilesPromise) return runtimeFilesPromise

  runtimeFilesPromise = (async () => {
    await initBasic()
    await initFiles()
    await cleanup()
    isRuntimeFilesCompleted = true
  })()

  try {
    await runtimeFilesPromise
  } finally {
    runtimeFilesPromise = null
  }
}

export async function init(): Promise<void> {
  const { sysProxy } = await getAppConfig()

  const initTasks: Promise<void>[] = [ensureRuntimeFiles(), startSSIDCheck()]

  // 文件分发服务：内部已捕获启动错误（记录到状态供 UI 展示），不会拖垮其他初始化
  initTasks.push(
    startFileShareServer().catch(() => {
      // ignore
    })
  )

  initTasks.push(
    (async (): Promise<void> => {
      try {
        if (sysProxy.enable) {
          await startPacServer()
        }
        await triggerSysProxy(sysProxy.enable)
      } catch {
        // ignore
      }
    })()
  )

  await Promise.all(initTasks)
}
