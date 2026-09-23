import { copyFile, mkdir, readFile, stat } from 'fs/promises'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'
import { isIP } from 'net'
import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileItem,
  getOverride,
  getOverrideItem,
  getOverrideConfig,
  getAppConfig
} from '../config'
import { getCustomLineGroupsConfig } from '../config/customLineGroups'
import {
  mihomoProfileWorkDir,
  mihomoWorkConfigPath,
  mihomoWorkDir,
  overridePath,
  rulePath
} from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'
import { decryptAgeContent } from '../utils/age'
import { DEFAULT_CONTROL_DNS, DEFAULT_CONTROL_SNIFF } from '../../shared/appConfig'
import { atomicWriteFile } from '../utils/safeFile'

const factoryLogger = createLogger('Factory')
const SMART_OVERRIDE_ID = 'smart-core-override'

let runtimeConfigStr: string = ''
let runtimeConfig: IMihomoConfig = {} as IMihomoConfig

interface GenerateProfileOptions {
  profileId?: string
  baseProfile?: IMihomoConfig
  ageSecretKey?: string
  profileOverrideIds?: string[]
  outputPath?: string
  updateRuntimeConfig?: boolean
}

// 辅助函数：处理带偏移量的规则
function processRulesWithOffset(ruleStrings: string[], currentRules: string[], isAppend = false) {
  const normalRules: string[] = []
  const rules = [...currentRules]

  ruleStrings.forEach((ruleStr) => {
    const parts = ruleStr.split(',')
    const firstPartIsNumber =
      !isNaN(Number(parts[0])) && parts[0].trim() !== '' && parts.length >= 3

    if (firstPartIsNumber) {
      const offset = parseInt(parts[0])
      const rule = parts.slice(1).join(',')

      if (isAppend) {
        // 后置规则的插入位置计算
        const insertPosition = Math.max(0, rules.length - Math.min(offset, rules.length))
        rules.splice(insertPosition, 0, rule)
      } else {
        // 前置规则的插入位置计算
        const insertPosition = Math.min(offset, rules.length)
        rules.splice(insertPosition, 0, rule)
      }
    } else {
      normalRules.push(ruleStr)
    }
  })

  return { normalRules, insertRules: rules }
}

/**
 * 确保在启用特定条件（如 Smart 覆写）且启用了 TUN 模式时，将代理服务器的 IP 地址添加到路由排除列表中，以避免路由回环。
 * 该函数会遍历配置中的所有代理节点，提取出服务器的 IP 地址（支持 IPv4/IPv6），并将其转换为对应的 CIDR 格式（IPv4: /32, IPv6: /128）。
 *
 * @param profile 当前的 Mihomo 配置对象
 * @param enabled 是否需要执行排除逻辑（通常为是否启用了 Smart 核心覆写）
 * @returns 此次新添加到排除列表中的网段/IP 数组
 */
function ensureSmartProxyServerTunExclude(profile: IMihomoConfig, enabled: boolean): string[] {
  if (!enabled || profile.tun?.enable !== true || !Array.isArray(profile.proxies)) return []

  const routeExcludeAddress = Array.isArray(profile.tun['route-exclude-address'])
    ? [...profile.tun['route-exclude-address']]
    : []
  profile.tun['route-exclude-address'] = routeExcludeAddress

  const existing = new Set(routeExcludeAddress.map((address) => address.trim().toLowerCase()))
  const added: string[] = []

  for (const proxy of profile.proxies as unknown[]) {
    if (!proxy || typeof proxy !== 'object') continue

    const server = (proxy as Record<string, unknown>).server
    if (typeof server !== 'string' && typeof server !== 'number') continue

    const host = String(server)
      .trim()
      .replace(/^\[(.*)\]$/, '$1')
      .toLowerCase()
    const ipVersion = isIP(host)
    if (!ipVersion) continue

    const cidr = ipVersion === 4 ? `${host}/32` : `${host}/128`
    if (existing.has(host) || existing.has(cidr)) continue

    routeExcludeAddress.push(cidr)
    existing.add(cidr)
    added.push(cidr)
  }

  return added
}

/**
 * 注入自定义线路组: 每组生成 入口组(自动/故障/手动子组) 与专属端口 listener。
 * 入口组名即线路组名, 子组名为 `${name}·自动|故障|手动`, listener 名为 `${name}·入口`。
 */
function applyCustomLineGroups(
  profile: IMihomoConfig,
  groups: ICustomLineGroup[]
): void {
  if (groups.length === 0) return
  const proxyGroups =
    (profile['proxy-groups'] as Record<string, unknown>[] | undefined) ?? []
  const listeners = (profile.listeners as IMihomoListenerConfig[] | undefined) ?? []
  const groupNames = new Set(proxyGroups.map((g) => g?.name))

  // 清理 pass: 停用(enabled === false)的组移除其入口组/子组与专属端口 listener,
  // 避免热重载后旧配置残留(组配置本身保留在 customLineGroups 文件中)
  const SUB_SUFFIXES = ['自动', '故障', '手动', '全局']
  groups
    .filter((g) => g.enabled === false)
    .forEach((g) => {
      const removeNames = [g.name, ...SUB_SUFFIXES.map((s) => `${g.name}·${s}`)]
      for (let i = proxyGroups.length - 1; i >= 0; i--) {
        if (removeNames.includes(String(proxyGroups[i]?.name))) proxyGroups.splice(i, 1)
      }
      const listenerIdx = listeners.findIndex((l) => l?.name === `${g.name}·入口`)
      if (listenerIdx >= 0) listeners.splice(listenerIdx, 1)
      removeNames.forEach((n) => groupNames.delete(n))
    })

  groups.forEach((g) => {
    if (!g.name || !g.port || !Array.isArray(g.proxies)) return
    if (g.enabled === false) return
    const proxies = g.proxies.filter(Boolean)
    if (proxies.length === 0) return

    const subNames: string[] = []
    const subDefs: { suffix: string; type: string; enable: boolean }[] = [
      { suffix: '自动', type: 'url-test', enable: g.auto !== false },
      { suffix: '故障', type: 'fallback', enable: g.fallback !== false },
      { suffix: '手动', type: 'select', enable: g.manual !== false },
      // 全局: select 直接包含全部线路, 可手选任意线路(不经过其他子组层级)
      { suffix: '全局', type: 'select', enable: g.global !== false }
    ]
    subDefs.forEach((def) => {
      if (!def.enable) return
      const subName = `${g.name}·${def.suffix}`
      if (groupNames.has(subName)) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: Record<string, any> = {
        name: subName,
        type: def.type,
        proxies: [...proxies]
      }
      // url/interval 仅对自动测速类子组有意义, select 类保持干净
      if (def.type !== 'select') {
        sub.url = g.testUrl || 'https://www.gstatic.com/generate_204'
        sub.interval = g.interval && g.interval > 0 ? g.interval : 300
      }
      proxyGroups.push(sub)
      groupNames.add(subName)
      subNames.push(subName)
    })
    if (subNames.length === 0) subNames.push(...proxies)

    if (!groupNames.has(g.name)) {
      proxyGroups.push({ name: g.name, type: 'select', proxies: [...subNames] })
      groupNames.add(g.name)
    }

    const listenerName = `${g.name}·入口`
    const listener = {
      name: listenerName,
      type: 'mixed',
      port: g.port,
      proxy: g.name
    }
    const existingIdx = listeners.findIndex((l) => l?.name === listenerName)
    if (existingIdx >= 0) {
      listeners[existingIdx] = listener
    } else {
      listeners.push(listener)
    }
  })

  profile['proxy-groups'] = proxyGroups as []
  profile.listeners = listeners
}

export async function generateProfile(
  pendingControledMihomoConfig?: Partial<IMihomoConfig>,
  options: GenerateProfileOptions = {}
): Promise<string | undefined> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  const profileId = options.profileId ?? current
  const {
    diffWorkDir = false,
    controlDns = DEFAULT_CONTROL_DNS,
    controlSniff = DEFAULT_CONTROL_SNIFF,
    useNameserverPolicy
  } = await getAppConfig()
  const currentProfileItem = await getProfileItem(profileId)
  const ageSecretKey = options.ageSecretKey ?? currentProfileItem?.ageSecretKey ?? ''
  const baseProfile = options.baseProfile ?? (await getProfile(profileId))
  const overrideIds = await getOrderedOverrideIds(profileId, options.profileOverrideIds)
  const profileWithNormalOverride = await applyOverrides(
    baseProfile,
    overrideIds.normal,
    ageSecretKey
  )
  const profileWithRuleOverride = await applyRuleOverride(profileId, profileWithNormalOverride)
  const currentProfile = await applyOverrides(
    profileWithRuleOverride,
    overrideIds.smart,
    ageSecretKey
  )
  let controledMihomoConfig = pendingControledMihomoConfig ?? (await getControledMihomoConfig())

  // 根据开关状态过滤控制配置
  controledMihomoConfig = { ...controledMihomoConfig }
  if (!controlDns) {
    delete controledMihomoConfig.dns
    delete controledMihomoConfig.hosts
  }
  if (!controlSniff) {
    delete controledMihomoConfig.sniffer
  }
  if (!useNameserverPolicy) {
    delete controledMihomoConfig?.dns?.['nameserver-policy']
  }

  const profile = deepMerge(currentProfile, controledMihomoConfig)
  // 注入自定义线路组(代理组 + 专属端口 listener)
  const { items: customGroups = [] } = await getCustomLineGroupsConfig()
  applyCustomLineGroups(profile, customGroups)
  // 关闭 DNS 覆写时，如果最终配置没有启用的 DNS 配置，清空 dns-hijack 避免请求被劫持但无法处理
  if (!controlDns && profile.tun && !profile.dns?.enable) {
    profile.tun = { ...profile.tun, 'dns-hijack': [] }
  }
  // Smart Override JS 早于受控 TUN 配置合并执行；最终配置写出前再排除代理服务器 IP。
  const addedProxyServerRouteExcludes = ensureSmartProxyServerTunExclude(
    profile,
    overrideIds.smart.length > 0
  )
  if (addedProxyServerRouteExcludes.length > 0) {
    factoryLogger.info(
      'Added Smart Override proxy server TUN route excludes',
      addedProxyServerRouteExcludes
    )
  }
  // 删除空的局域网允许列表，避免局域网访问异常
  if (!profile['lan-allowed-ips']?.length) {
    delete profile['lan-allowed-ips']
  }
  // WebUI 仅在外部控制器启用时有效；关闭面板时不向 Mihomo 写入下载地址。
  const partialProfile = profile as Partial<IMihomoConfig>
  if (profile['external-controller'] === '') {
    delete partialProfile['external-controller']
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
    delete partialProfile['external-controller-cors']
  } else if (profile['external-ui'] === '') {
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
  }
  const nextRuntimeConfigStr = stringify(profile)
  const coreProfile = { ...profile }
  // 日志解析启动检测需要基础日志；预览和 Gist 保留用户的实际配置。
  if (['info', 'debug'].includes(coreProfile['log-level']) === false) {
    coreProfile['log-level'] = 'info'
  }
  const coreConfigStr = stringify(coreProfile)
  if (diffWorkDir && options.outputPath === undefined) {
    await prepareProfileWorkDir(profileId)
  }
  await atomicWriteFile(
    options.outputPath ??
      (diffWorkDir ? mihomoWorkConfigPath(profileId) : mihomoWorkConfigPath('work')),
    coreConfigStr
  )
  if (options.updateRuntimeConfig !== false) {
    runtimeConfig = profile
    runtimeConfigStr = nextRuntimeConfigStr
  }
  return profileId
}

async function applyRuleOverride(
  current: string | undefined,
  profile: IMihomoConfig
): Promise<IMihomoConfig> {
  try {
    const ruleFilePath = rulePath(current || 'default')
    if (!existsSync(ruleFilePath)) {
      return profile
    }

    const ruleFileContent = await readFile(ruleFilePath, 'utf-8')
    const ruleData = parse(ruleFileContent) as {
      prepend?: string[]
      append?: string[]
      delete?: string[]
    } | null

    if (!ruleData || typeof ruleData !== 'object') {
      return profile
    }

    if (!profile.rules) {
      profile.rules = [] as unknown as []
    }

    let rules = [...profile.rules] as unknown as string[]

    if (ruleData.prepend?.length) {
      const { normalRules: prependRules, insertRules } = processRulesWithOffset(
        ruleData.prepend,
        rules
      )
      rules = [...prependRules, ...insertRules]
    }

    if (ruleData.append?.length) {
      const { normalRules: appendRules, insertRules } = processRulesWithOffset(
        ruleData.append,
        rules,
        true
      )
      rules = [...insertRules, ...appendRules]
    }

    if (ruleData.delete?.length) {
      const deleteSet = new Set(ruleData.delete)
      rules = rules.filter((rule) => {
        const ruleStr = Array.isArray(rule) ? rule.join(',') : rule
        return !deleteSet.has(ruleStr)
      })
    }

    profile.rules = rules as unknown as []
    return profile
  } catch (error) {
    factoryLogger.error('Failed to read or apply rule file', error)
    return profile
  }
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }

  const isSourceNewer = async (sourcePath: string, targetPath: string): Promise<boolean> => {
    try {
      const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
      return sourceStats.mtime > targetStats.mtime
    } catch {
      return true
    }
  }

  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)
    const sourcePath = path.join(mihomoWorkDir(), file)
    if (!existsSync(sourcePath)) return
    // 复制条件：目标不存在 或 源文件更新
    const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
    if (shouldCopy) {
      await copyFile(sourcePath, targetPath)
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb'),
    copy('BundleMRS.7z')
  ])
}

async function getOrderedOverrideIds(
  current: string | undefined,
  profileOverrideIds?: string[]
): Promise<{
  normal: string[]
  smart: string[]
}> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const override = profileOverrideIds ?? (await getProfileItem(current))?.override ?? []
  const orderedOverrideIds = [...new Set(globalOverride.concat(override))]

  return {
    normal: orderedOverrideIds.filter((id) => id !== SMART_OVERRIDE_ID),
    smart: orderedOverrideIds.filter((id) => id === SMART_OVERRIDE_ID)
  }
}

async function applyOverrides(
  profile: IMihomoConfig,
  overrideIds: string[],
  ageSecretKey: string
): Promise<IMihomoConfig> {
  for (const ov of overrideIds) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = runOverrideScript(profile, content, item)
        break
      case 'yaml': {
        const decryptedContent = await decryptAgeContent(content, ageSecretKey, `override "${ov}"`)
        let patch = parse(decryptedContent) || {}
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch, true)
        break
      }
    }
  }
  return profile
}

function runOverrideScript(
  profile: IMihomoConfig,
  script: string,
  item: IOverrideItem
): IMihomoConfig {
  const log = (type: string, data: string, flag = 'a'): void => {
    writeFileSync(overridePath(item.id, 'log'), `[${type}] ${data}\n`, {
      encoding: 'utf-8',
      flag
    })
  }
  try {
    const ctx = {
      console: Object.freeze({
        log(data: never) {
          log('log', JSON.stringify(data))
        },
        info(data: never) {
          log('info', JSON.stringify(data))
        },
        error(data: never) {
          log('error', JSON.stringify(data))
        },
        debug(data: never) {
          log('debug', JSON.stringify(data))
        }
      })
    }
    vm.createContext(ctx)
    const code = `${script} main(${JSON.stringify(profile)})`
    log('info', '开始执行脚本', 'w')
    const newProfile = vm.runInContext(code, ctx)
    if (typeof newProfile !== 'object') {
      throw new Error('脚本返回值必须是对象')
    }
    log('info', '脚本执行成功')
    return newProfile
  } catch (e) {
    log('exception', `脚本执行失败：${e}`)
    return profile
  }
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRuntimeConfig(): Promise<IMihomoConfig> {
  return runtimeConfig
}
