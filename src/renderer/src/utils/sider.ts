import { DEFAULT_SIDER_ORDER } from '../../../shared/appConfig'

export const SIDER_CARD_KEYS: SiderCardKey[] = DEFAULT_SIDER_ORDER

export const SIDER_CARD_ROUTES: Record<SiderCardKey, string> = {
  profile: '/profiles',
  proxy: '/proxies',
  rule: '/rules',
  resource: '/resources',
  override: '/override',
  connection: '/connections',
  mihomo: '/mihomo',
  dns: '/dns',
  sniff: '/sniffer',
  log: '/logs',
  network: '/network',
  usage: '/traffic',
  fileShare: '/file-share'
}

// 已保存顺序在前（过滤非法项），缺的键按默认顺序补齐
export function mergeCardOrder<T extends string>(saved: readonly string[], all: readonly T[]): T[] {
  const valid = saved.filter((key): key is T => (all as readonly string[]).includes(key))
  const missing = all.filter((key) => !valid.includes(key))
  return [...valid, ...missing]
}

export function mergeSiderOrder(saved: string[] = []): SiderCardKey[] {
  return mergeCardOrder(saved, SIDER_CARD_KEYS)
}

export function getSiderCardRoute(card?: string): string {
  if (!card || !SIDER_CARD_KEYS.includes(card as SiderCardKey)) {
    return SIDER_CARD_ROUTES.proxy
  }
  return SIDER_CARD_ROUTES[card as SiderCardKey]
}

export function getSiderCardByPath(pathname: string): SiderCardKey | undefined {
  return SIDER_CARD_KEYS.find((key) => SIDER_CARD_ROUTES[key] === pathname)
}
