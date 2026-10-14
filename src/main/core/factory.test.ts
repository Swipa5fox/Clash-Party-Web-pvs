import { describe, it, expect } from 'vitest'
import { applyCustomLineGroups, reorderGroupMembersNodesFirst } from './factory'

const asConfig = (
  groups: Record<string, unknown>[]
): { 'proxy-groups': Record<string, unknown>[] } => ({ 'proxy-groups': groups })

const asGroup = (over: Partial<ICustomLineGroup>): ICustomLineGroup => ({
  id: 'test-id',
  name: 'Test',
  port: 8808,
  proxies: [],
  auto: true,
  fallback: true,
  manual: true,
  global: true,
  ...over
})

describe('reorderGroupMembersNodesFirst', () => {
  it('节点前置、组引用后置: 默认选中落在第一个节点', () => {
    const cfg = asConfig([
      {
        name: 'LILISI',
        type: 'select',
        proxies: ['自动选择', '故障转移', '🇭🇰 高级 | 香港 01', '🇺🇸 标准 | 美国 01']
      },
      { name: '自动选择', type: 'url-test', proxies: ['🇭🇰 高级 | 香港 01', '🇺🇸 标准 | 美国 01'] },
      { name: '故障转移', type: 'fallback', proxies: ['🇭🇰 高级 | 香港 01', '🇺🇸 标准 | 美国 01'] }
    ])
    reorderGroupMembersNodesFirst(cfg as never)
    expect(cfg['proxy-groups'][0].proxies).toEqual([
      '🇭🇰 高级 | 香港 01',
      '🇺🇸 标准 | 美国 01',
      '自动选择',
      '故障转移'
    ])
    // 无组引用的组保持原序
    expect(cfg['proxy-groups'][1].proxies).toEqual(['🇭🇰 高级 | 香港 01', '🇺🇸 标准 | 美国 01'])
  })

  it('内建策略不前置: 组里只有 DIRECT + 组引用时不动', () => {
    const cfg = asConfig([
      { name: 'A', type: 'select', proxies: ['自动选择', 'DIRECT'] },
      { name: '自动选择', type: 'url-test', proxies: ['n1'] }
    ])
    reorderGroupMembersNodesFirst(cfg as never)
    expect(cfg['proxy-groups'][0].proxies).toEqual(['自动选择', 'DIRECT'])
  })

  it('已节点在前或纯组成员的组保持原样', () => {
    const cfg = asConfig([
      { name: 'B', type: 'select', proxies: ['n1', 'n2', '自动选择'] },
      { name: 'AU', type: 'select', proxies: ['AU·自动'] },
      { name: 'AU·自动', type: 'url-test', proxies: ['a1', 'a2'] },
      { name: '自动选择', type: 'url-test', proxies: ['n1'] }
    ])
    reorderGroupMembersNodesFirst(cfg as never)
    expect(cfg['proxy-groups'][0].proxies).toEqual(['n1', 'n2', '自动选择'])
    expect(cfg['proxy-groups'][1].proxies).toEqual(['AU·自动'])
  })

  it('空/缺 proxy-groups 不抛错', () => {
    expect(() => reorderGroupMembersNodesFirst({} as never)).not.toThrow()
    expect(() => reorderGroupMembersNodesFirst(asConfig([]) as never)).not.toThrow()
  })
})

describe('applyCustomLineGroups', () => {
  const NODES = [{ name: '🇭🇰 香港 01' }, { name: '🇭🇰 香港 02' }, { name: '🇺🇸 美国 01' }]

  const run = (groups: ICustomLineGroup[], preExisting: Record<string, unknown>[] = []) => {
    const profile = {
      proxies: NODES,
      'proxy-groups': preExisting,
      listeners: [],
      rules: []
    } as unknown as IMihomoConfig
    applyCustomLineGroups(profile, groups)
    return profile
  }

  const groupNames = (profile: IMihomoConfig): string[] =>
    (profile['proxy-groups'] as Record<string, unknown>[]).map((g) => String(g.name))

  it('注入入口组+四个子组+专属端口 listener(挂同名子规则)', () => {
    const profile = run([asGroup({ proxies: ['🇭🇰 香港 01', '🇺🇸 美国 01'] })])
    expect(groupNames(profile)).toEqual([
      'Test·自动',
      'Test·故障',
      'Test·手动',
      'Test·全局',
      'Test'
    ])
    const auto = (profile['proxy-groups'] as Record<string, unknown>[])[0]
    expect(auto.type).toBe('url-test')
    expect(auto.url).toBe('https://www.gstatic.com/generate_204')
    expect(auto.interval).toBe(300)
    const entry = (profile['proxy-groups'] as Record<string, unknown>[]).at(-1)
    expect(entry.proxies).toEqual(['Test·自动', 'Test·故障', 'Test·手动', 'Test·全局'])
    // listener 不绑 proxy(绑了就是无条件直出、内网也出线), 改挂同名子规则
    expect(profile.listeners).toEqual([
      { name: 'Test·入口', type: 'mixed', port: 8808, rule: 'Test·入口' }
    ])
    // 子规则: 豁免(内网/国内直连)在前, MATCH 兜底到入口组
    const subRules = profile['sub-rules']['Test·入口']
    expect(subRules.at(-1)).toBe('MATCH,Test')
    expect(subRules).toContain('IP-CIDR,192.168.0.0/16,DIRECT,no-resolve')
    expect(subRules).toContain('GEOIP,CN,DIRECT')
  })

  it('线路口豁免抄用 profile 里已有的 RULE-SET,DIRECT(国内直连覆写), 去重', () => {
    const profile = {
      proxies: NODES,
      'proxy-groups': [],
      listeners: [],
      rules: [
        'RULE-SET,china-direct,DIRECT',
        'RULE-SET,china-direct,DIRECT',
        'RULE-SET,proxy-list,LILISI',
        'MATCH,LILISI'
      ]
    } as unknown as IMihomoConfig
    applyCustomLineGroups(profile, [asGroup({ proxies: ['🇭🇰 香港 01'] })])
    const subRules = profile['sub-rules']['Test·入口']
    expect(subRules.filter((r) => r === 'RULE-SET,china-direct,DIRECT')).toHaveLength(1)
    expect(subRules).not.toContain('RULE-SET,proxy-list,LILISI')
    // 豁免必须排在 MATCH 兜底之前
    expect(subRules.indexOf('RULE-SET,china-direct,DIRECT')).toBeLessThan(
      subRules.indexOf('MATCH,Test')
    )
  })

  it('失效节点名剔除, 只注入仍存在的节点', () => {
    const profile = run([asGroup({ proxies: ['🇭🇰 香港 01', '旧订阅节点', '🇺🇸 美国 01'] })])
    const manual = (profile['proxy-groups'] as Record<string, unknown>[]).find(
      (g) => g.name === 'Test·手动'
    )
    expect(manual.proxies).toEqual(['🇭🇰 香港 01', '🇺🇸 美国 01'])
  })

  it('节点名全部失效则整组跳过: 不注入组也不注入 listener/子规则', () => {
    const profile = run([asGroup({ proxies: ['不存在的节点'] })])
    expect(profile['proxy-groups']).toEqual([])
    expect(profile.listeners).toEqual([])
    expect(profile['sub-rules']).toBeUndefined()
  })

  it('停用组清理: 移除旧注入的组/子组/listener/子规则(配置保留在数据文件)', () => {
    const profile = {
      proxies: NODES,
      'proxy-groups': [
        { name: 'Test', type: 'select', proxies: ['Test·自动'] },
        { name: 'Test·自动', type: 'url-test', proxies: ['🇭🇰 香港 01'] },
        { name: 'Test·全局', type: 'select', proxies: ['🇭🇰 香港 01'] },
        { name: '订阅组', type: 'select', proxies: ['🇭🇰 香港 01'] }
      ],
      listeners: [{ name: 'Test·入口', type: 'mixed', port: 8808, rule: 'Test·入口' }],
      'sub-rules': { 'Test·入口': ['MATCH,Test'], 订阅自带: ['MATCH,DIRECT'] },
      rules: []
    } as unknown as IMihomoConfig
    applyCustomLineGroups(profile, [asGroup({ enabled: false })])
    expect(groupNames(profile)).toEqual(['订阅组'])
    expect(profile.listeners).toEqual([])
    // 只删自己注入的键, 订阅自带的 sub-rules 保留
    expect(profile['sub-rules']).toEqual({ 订阅自带: ['MATCH,DIRECT'] })
  })

  it('停用组不注入新组', () => {
    const profile = run([asGroup({ enabled: false })])
    expect(profile['proxy-groups']).toEqual([])
    expect(profile.listeners).toEqual([])
    // 空 sub-rules 不留残键
    expect('sub-rules' in profile).toBe(false)
  })

  it('关掉的子组类型不注入, 入口组只含启用的子组', () => {
    const profile = run([
      asGroup({
        auto: false,
        fallback: false,
        manual: false,
        global: false,
        proxies: ['🇭🇰 香港 01']
      })
    ])
    // 四个子组全关: 入口组直接落节点
    expect(groupNames(profile)).toEqual(['Test'])
    const entry = (profile['proxy-groups'] as Record<string, unknown>[])[0]
    expect(entry.proxies).toEqual(['🇭🇰 香港 01'])
  })

  it('组名/端口缺失或空 proxies 不注入', () => {
    expect(run([asGroup({ name: '' })])['proxy-groups']).toEqual([])
    expect(run([asGroup({ port: 0 })])['proxy-groups']).toEqual([])
    expect(run([asGroup({ proxies: [] })])['proxy-groups']).toEqual([])
  })

  it('同名订阅组已存在时不覆盖, 子组正常追加', () => {
    const profile = run(
      [asGroup({ proxies: ['🇭🇰 香港 01'] })],
      [{ name: 'Test', type: 'url-test', proxies: ['订阅原成员'] }]
    )
    const entry = (profile['proxy-groups'] as Record<string, unknown>[]).find(
      (g) => g.name === 'Test'
    )
    expect(entry.proxies).toEqual(['订阅原成员'])
    expect(groupNames(profile)).toContain('Test·自动')
    // listener/sub-rules 挂到既有入口组名上
    expect(profile.listeners).toEqual([
      { name: 'Test·入口', type: 'mixed', port: 8808, rule: 'Test·入口' }
    ])
    expect(profile['sub-rules']['Test·入口'].at(-1)).toBe('MATCH,Test')
  })
})
