// 自定义线路组共享常量 — 主进程注入(factory.ts)与选线器(custom-line-groups-modal)共用。
// 子组后缀是双端约定: 改 suffix/flag 必须同时验证注入与组下拉排除。

export const CUSTOM_LINE_SUB_GROUP_DEFS = [
  { suffix: '自动', type: 'url-test', flag: 'auto' },
  { suffix: '故障', type: 'fallback', flag: 'fallback' },
  { suffix: '手动', type: 'select', flag: 'manual' },
  // 全局: select 直接包含全部线路, 可手选任意线路(不经过其他子组层级)
  { suffix: '全局', type: 'select', flag: 'global' }
] as const

export const CUSTOM_LINE_SUB_SUFFIXES = CUSTOM_LINE_SUB_GROUP_DEFS.map((d) => d.suffix)

// mihomo 内建策略, 不是节点
export const BUILTIN_POLICIES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'])

// 线路口"内网/国内直连豁免": 命中即 DIRECT, 不落入口组走本线路。
// 国内域名清单不在这里维护——注入时会把 profile 里已有的 `RULE-SET,*,DIRECT`
// (国内直连覆写)原样抄进子规则, 用户改覆写即时跟随; 这里只兜内网段与 CN 兜底。
export const LINE_GROUP_DIRECT_EXEMPTIONS = [
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  'DOMAIN-SUFFIX,cn,DIRECT',
  'GEOIP,CN,DIRECT'
] as const

// 线路口子规则键: 与 listener 同名, 便于在生成配置里对照
export const lineGroupSubRuleKey = (name: string): string => `${name}·入口`

// 一个线路组的全部注入名: 入口组 + 子组, 用于排重/停用清理/组下拉排除
export const customLineGroupNames = (name: string): string[] => [
  name,
  ...CUSTOM_LINE_SUB_SUFFIXES.map((s) => `${name}·${s}`)
]
