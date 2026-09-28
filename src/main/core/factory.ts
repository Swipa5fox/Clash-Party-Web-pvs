import { copyFile, mkdir, readFile } from 'fs/promises'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'
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
import {
  BUILTIN_POLICIES,
  CUSTOM_LINE_SUB_GROUP_DEFS,
  customLineGroupNames
} from '../../shared/customLineGroups'
import { atomicWriteFile } from '../utils/safeFile'
import { isSourceNewer } from '../utils/init'

const factoryLogger = createLogger('Factory')

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
 * 注入自定义线路组: 每组生成 入口组(自动/故障/手动/全局子组) 与专属端口 listener。
 * 入口组名即线路组名, 子组名为 `${name}·自动|故障|手动|全局`, listener 名为 `${name}·入口`。
 * 节点名与当前订阅求交集: 订阅节点名变了/换订阅后失效名字剔除、整组空则不注入,
 * 避免注入不存在节点的组让内核拒绝整份配置(导入校验/热重载全被卡死)。
 */
export function applyCustomLineGroups(profile: IMihomoConfig, groups: ICustomLineGroup[]): void {
  if (groups.length === 0) return
  const proxyGroups = (profile['proxy-groups'] as Record<string, unknown>[] | undefined) ?? []
  const listeners = (profile.listeners as IMihomoListenerConfig[] | undefined) ?? []
  const availableNames = new Set(
    (profile.proxies as { name?: unknown }[] | undefined)?.map((p) => String(p?.name))
  )

  removeDisabledGroups(proxyGroups, listeners, groups)
  groups.forEach((g) => injectOneGroup(g, proxyGroups, listeners, availableNames))

  profile['proxy-groups'] = proxyGroups as []
  profile.listeners = listeners
}

// 停用(enabled === false)的组移除其入口组/子组与专属端口 listener,
// 避免热重载后旧配置残留(组配置本身保留在 customLineGroups 文件中)
function removeDisabledGroups(
  proxyGroups: Record<string, unknown>[],
  listeners: IMihomoListenerConfig[],
  groups: ICustomLineGroup[]
): void {
  groups
    .filter((g) => g.enabled === false)
    .forEach((g) => {
      const removeNames = customLineGroupNames(g.name)
      for (let i = proxyGroups.length - 1; i >= 0; i--) {
        if (removeNames.includes(String(proxyGroups[i]?.name))) proxyGroups.splice(i, 1)
      }
      const listenerIdx = listeners.findIndex((l) => l?.name === `${g.name}·入口`)
      if (listenerIdx >= 0) listeners.splice(listenerIdx, 1)
    })
}

function injectOneGroup(
  g: ICustomLineGroup,
  proxyGroups: Record<string, unknown>[],
  listeners: IMihomoListenerConfig[],
  availableNames: Set<string>
): void {
  if (!g.name || !g.port || !Array.isArray(g.proxies)) return
  if (g.enabled === false) return
  const proxies = g.proxies.filter((n) => typeof n === 'string' && availableNames.has(n))
  if (proxies.length === 0) return

  const groupNames = new Set(proxyGroups.map((x) => String(x?.name)))
  const subNames = CUSTOM_LINE_SUB_GROUP_DEFS.filter((def) => g[def.flag] !== false)
    .map((def) => {
      const subName = `${g.name}·${def.suffix}`
      if (groupNames.has(subName)) return null
      const sub: Record<string, unknown> = {
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
      return subName
    })
    .filter((n): n is string => n !== null)
  if (subNames.length === 0) subNames.push(...proxies)

  if (!groupNames.has(g.name)) {
    proxyGroups.push({ name: g.name, type: 'select', proxies: [...subNames] })
  }

  const listener = {
    name: `${g.name}·入口`,
    type: 'mixed',
    port: g.port,
    proxy: g.name
  }
  const existingIdx = listeners.findIndex((l) => l?.name === listener.name)
  if (existingIdx >= 0) {
    listeners[existingIdx] = listener
  } else {
    listeners.push(listener)
  }
}

/**
 * 组成员排序: 节点前置、组引用后置。
 * select 组无手选记录时默认选中第一个成员, 订阅常把 自动选择/故障转移 排在最前,
 * 导致"默认进自动模式"。节点前置后默认即第一个节点(如 高级|香港 01);
 * 手选记忆由 mihomo profile.store-selected 按名字恢复, 不受顺序影响。
 */
export function reorderGroupMembersNodesFirst(profile: IMihomoConfig): void {
  const groups = profile['proxy-groups'] as Record<string, unknown>[] | undefined
  if (!groups?.length) return
  const groupNames = new Set(groups.map((g) => String(g?.name)))
  for (const g of groups) {
    const members = g?.proxies
    if (!Array.isArray(members) || members.length < 2) continue
    // 只前置"真节点"(非组、非内建策略); 其余(组引用/内建策略/非字符串)原序后置
    const nodes = members.filter(
      (m) => typeof m === 'string' && !groupNames.has(m) && !BUILTIN_POLICIES.has(m)
    )
    if (nodes.length === 0) continue
    const rest = members.filter((m) => !nodes.includes(m))
    if (nodes[0] === members[0]) continue
    g.proxies = [...nodes, ...rest]
  }
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
  const profileWithOverride = await applyOverrides(baseProfile, overrideIds, ageSecretKey)
  const currentProfile = await applyRuleOverride(profileId, profileWithOverride)
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
  // 组成员节点前置: select 组默认(无手选记录时)落在第一个节点而非 自动选择/故障转移
  reorderGroupMembersNodesFirst(profile)
  // 关闭 DNS 覆写时，如果最终配置没有启用的 DNS 配置，清空 dns-hijack 避免请求被劫持但无法处理
  if (!controlDns && profile.tun && !profile.dns?.enable) {
    profile.tun = { ...profile.tun, 'dns-hijack': [] }
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
): Promise<string[]> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const override = profileOverrideIds ?? (await getProfileItem(current))?.override ?? []
  return [...new Set(globalOverride.concat(override))]
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
