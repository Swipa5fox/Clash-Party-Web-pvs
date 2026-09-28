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

// 一个线路组的全部注入名: 入口组 + 子组, 用于排重/停用清理/组下拉排除
export const customLineGroupNames = (name: string): string[] => [
  name,
  ...CUSTOM_LINE_SUB_SUFFIXES.map((s) => `${name}·${s}`)
]
