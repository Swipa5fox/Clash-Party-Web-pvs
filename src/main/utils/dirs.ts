import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { installRoot } from '../runtime'

export const homeDir = homedir()

// 数据目录：CP_DATA_DIR 显式指定 > tarball 根旁 data/ > XDG_DATA_HOME。
// portable/exe 概念随桌面壳一并移除。
function resolveDataDir(): string {
  if (process.env.CP_DATA_DIR) return process.env.CP_DATA_DIR
  const root = installRoot()
  // tarball 部署根（含 resources/ 但不含 src/）旁的 data/ 才算自带布局，
  // 避免把 repo 仓库误判成安装目录。
  const isInstall = existsSync(path.join(root, 'resources')) && !existsSync(path.join(root, 'src'))
  if (isInstall) return path.join(root, 'data')
  const xdg = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share')
  return path.join(xdg, 'clash-party')
}

let dataDirPath: string | null = null

export function configureAppPaths(): void {
  dataDirPath = resolveDataDir()
}

export function dataDir(): string {
  if (!dataDirPath) dataDirPath = resolveDataDir()
  return dataDirPath
}

export function exePath(): string {
  return process.argv[1] ? path.resolve(process.argv[1]) : process.execPath
}

export function exeDir(): string {
  return path.dirname(exePath())
}

export function resourcesDir(): string {
  // tarball: 根/resources；repo（dev 与 dist bundle）: extra/。
  if (existsSync(path.join(installRoot(), 'resources')))
    return path.join(installRoot(), 'resources')
  return path.join(installRoot(), 'extra')
}

export function resourcesFilesDir(): string {
  return path.join(resourcesDir(), 'files')
}

export function themesDir(): string {
  return path.join(dataDir(), 'themes')
}

export function mihomoCoreDir(): string {
  return path.join(resourcesDir(), 'sidecar')
}

export function mihomoCorePath(core: string): string {
  const isWin = process.platform === 'win32'
  return path.join(mihomoCoreDir(), `${core}${isWin ? '.exe' : ''}`)
}

export function appConfigPath(): string {
  return path.join(dataDir(), 'config.yaml')
}

export function controledMihomoConfigPath(): string {
  return path.join(dataDir(), 'mihomo.yaml')
}

export function profileConfigPath(): string {
  return path.join(dataDir(), 'profile.yaml')
}

export function profilesDir(): string {
  return path.join(dataDir(), 'profiles')
}

export function profilePath(id: string): string {
  return path.join(profilesDir(), `${id}.yaml`)
}

export function pluginConfigPath(): string {
  return path.join(dataDir(), 'plugin.yaml')
}

export function pluginVaultDir(): string {
  return path.join(dataDir(), 'plugin-vault')
}

export function pluginVaultPath(id: string): string {
  return path.join(pluginVaultDir(), `${id}.bin`)
}

export function overrideDir(): string {
  return path.join(dataDir(), 'override')
}

export function overrideConfigPath(): string {
  return path.join(dataDir(), 'override.yaml')
}

export function customLineGroupsConfigPath(): string {
  return path.join(dataDir(), 'custom-line-groups.yaml')
}

export function overridePath(id: string, ext: 'js' | 'yaml' | 'log'): string {
  return path.join(overrideDir(), `${id}.${ext}`)
}

export function mihomoWorkDir(): string {
  return path.join(dataDir(), 'work')
}

export function mihomoProfileWorkDir(id: string | undefined): string {
  return path.join(mihomoWorkDir(), id || 'default')
}

export function mihomoTestDir(): string {
  return path.join(dataDir(), 'test')
}

export function mihomoWorkConfigPath(id: string | undefined): string {
  if (id === 'work') {
    return path.join(mihomoWorkDir(), 'config.yaml')
  } else {
    return path.join(mihomoProfileWorkDir(id), 'config.yaml')
  }
}

export function logDir(): string {
  return path.join(dataDir(), 'logs')
}

function dateStamp(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function logPath(): string {
  return path.join(logDir(), `clash-party-${dateStamp()}.log`)
}

export function coreLogPath(): string {
  return path.join(logDir(), `core-${dateStamp()}.log`)
}

export function rulesDir(): string {
  return path.join(dataDir(), 'rules')
}

export function fileShareDir(): string {
  return path.join(dataDir(), 'file-share')
}

// 文件分发元数据(别名/分组): 与分发文件分离,记录 file -> { alias, group }
export function fileShareMetaPath(): string {
  return path.join(dataDir(), 'file-share-meta.json')
}

export function rulePath(id: string): string {
  return path.join(rulesDir(), `${id}.yaml`)
}
