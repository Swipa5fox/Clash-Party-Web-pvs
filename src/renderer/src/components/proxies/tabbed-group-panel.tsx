import { Button, Card, CardBody } from '@heroui/react'
import React, { useMemo, useState, useCallback } from 'react'
import { IoIosArrowBack } from 'react-icons/io'
import { MdOutlineSpeed } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { KeyedMutator } from 'swr'
import ProxyItem from './proxy-item'

// 同线路子组族检测与 tab 合并容器:
// 自定义线路组的 自动/故障/手动/全局 4 个子组包含同一批线路,
// 逐个渲染成大面板会占据大量纵向空间("过多自动分组"), 因此把同线路的
// 子组合并为一行紧凑 tab(线路列表为主体), 不同线路的一般订阅嵌套不受影响。

// 面板展开状态: 与 NestedGroupPanel 共用同一模块级 Map 语义,独立存一份避免循环依赖
const tabbedOpenState = new Map<string, boolean>()

const SUBGROUP_TYPE_LABEL: Record<string, string> = {
  Selector: '手动',
  URLTest: '自动',
  Fallback: '故障',
  LoadBalance: '负载'
}

// 标签优先取子组名后缀(组名·全局): "全局"子组 type 也是 Selector,
// 按 type 映射会被误标为"手动"(自动/故障/手动/手动),按后缀则始终准确
const SUFFIX_LABELS = new Set(['自动', '故障', '手动', '全局', '负载'])
function tabLabel(sub: IMihomoMixedGroup): string {
  const idx = sub.name.lastIndexOf('·')
  if (idx >= 0) {
    const suffix = sub.name.slice(idx + 1)
    if (SUFFIX_LABELS.has(suffix)) return suffix
  }
  return SUBGROUP_TYPE_LABEL[sub.type] ?? sub.type
}

// 子组的节点名集合签名(排序后拼接), 用于判定"同线路族"
function lineSignature(sub: IMihomoMixedGroup): string {
  return sub.all
    .map((p) => p.name)
    .sort()
    .join('\u0000')
}

/**
 * 拆分同线路子组族: 若 subs 中开头存在 ≥2 个节点名集合完全相同的连续子组,
 * 视为一个族(自定义线路组形态), 其余子组照旧逐面板渲染。
 */
export function splitUniformLineFamily(subs: IMihomoMixedGroup[]): {
  family: IMihomoMixedGroup[] | null
  rest: IMihomoMixedGroup[]
} {
  if (subs.length < 2) return { family: null, rest: subs }
  const signature = lineSignature(subs[0])
  const family: IMihomoMixedGroup[] = [subs[0]]
  let i = 1
  for (; i < subs.length; i++) {
    if (lineSignature(subs[i]) !== signature) break
    family.push(subs[i])
  }
  if (family.length < 2) return { family: null, rest: subs }
  return { family, rest: subs.slice(i) }
}

interface Props {
  // 同线路子组族(如 组名·自动/故障/手动/全局)
  family: IMihomoMixedGroup[]
  // 父组(入口组): 点 tab = 让父组切换到该子组
  parentGroup: IMihomoMixedGroup
  mutateProxies: KeyedMutator<IMihomoMixedGroup[]>
  onProxyDelay: (proxy: IMihomoProxy | IMihomoGroup, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  onSelect: (group: string, proxy: string) => void
  isGroupTesting?: boolean
  // 展开状态 key(族首子组路径)
  pathKey: string
}

const TabbedGroupPanelBase: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const {
    family,
    parentGroup,
    mutateProxies,
    onSelect,
    onProxyDelay,
    proxyDisplayMode,
    isGroupTesting = false,
    pathKey
  } = props

  const [open, setOpen] = useState(() => tabbedOpenState.get(pathKey) ?? false)
  const [delayingAll, setDelayingAll] = useState(false)

  const toggleOpen = useCallback((): void => {
    setOpen((prev) => {
      tabbedOpenState.set(pathKey, !prev)
      return !prev
    })
  }, [pathKey])

  // active 子组 = 父组当前选中的子组; 若父组未选中任何族内子组则回退族首
  const activeSub = useMemo(
    () => family.find((sub) => sub.name === parentGroup.now) ?? family[0],
    [family, parentGroup.now]
  )

  // select 类子组(手动/全局)下点线路 = 对该子组手选; 测速类子组下选择无意义,
  // 点卡片身体不触发选择(单点测速按钮照常可用)
  const activeSelectable = activeSub.type === 'Selector'
  const handleNodeSelect = useCallback(
    (group: string, proxy: string): void => {
      if (activeSelectable) onSelect(group, proxy)
    },
    [activeSelectable, onSelect]
  )

  const nodes = useMemo(
    () => activeSub.all.filter((p): p is IMihomoProxy => !('all' in p)),
    [activeSub.all]
  )

  const testAllDelay = useCallback((): void => {
    setDelayingAll(true)
    Promise.allSettled(nodes.map((node) => onProxyDelay(node, parentGroup.testUrl))).finally(() => {
      mutateProxies()
      setDelayingAll(false)
    })
  }, [nodes, parentGroup.testUrl, onProxyDelay, mutateProxies])

  return (
    <div className="w-full">
      <Card as="div" fullWidth shadow="sm" radius="sm" className="bg-content2">
        <CardBody className="p-1.5">
          {/* tab 行: 同线路子族合并为一行紧凑分段按钮, active 即父组当前策略 */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              {family.map((sub) => {
                const active = sub.name === parentGroup.now
                const label = tabLabel(sub)
                return (
                  <div
                    key={sub.name}
                    className={`cursor-pointer select-none rounded-full border px-2 h-6 flex items-center gap-1 text-xs transition-colors ${
                      active
                        ? 'bg-primary/30 border-primary text-primary font-bold'
                        : 'border-divider text-foreground-500 hover:bg-default/40'
                    }`}
                    title={`${sub.name} | ${sub.now}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(parentGroup.name, sub.name)
                    }}
                  >
                    <span className="shrink-0">{label}</span>
                    <span className="max-w-[10rem] truncate flag-emoji">{sub.now}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center shrink-0">
              <Button
                isIconOnly
                title={t('proxies.delay.test')}
                variant="light"
                size="sm"
                isLoading={delayingAll}
                onPress={testAllDelay}
                className="h-6 w-6 min-w-6"
                onClick={(e) => e.stopPropagation?.()}
              >
                <MdOutlineSpeed className="text-md text-foreground-500" />
              </Button>
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  toggleOpen()
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <IoIosArrowBack
                  className={`transition duration-200 h-5 w-5 text-lg text-foreground-500 ${open ? '-rotate-90' : ''}`}
                />
              </div>
            </div>
          </div>
          {/* 线路网格(主体): 容器宽度自适应列, 窄一列/宽多列 */}
          {open && (
            <div className="@container mt-1.5">
              <div className="grid gap-1 grid-cols-1 @2xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
                {nodes.map((node) => (
                  <ProxyItem
                    key={node.name}
                    mutateProxies={mutateProxies}
                    onProxyDelay={onProxyDelay}
                    onSelect={handleNodeSelect}
                    proxy={node}
                    group={{ ...activeSub, fixed: undefined } as IMihomoMixedGroup}
                    proxyDisplayMode={proxyDisplayMode}
                    selected={activeSelectable && node.name === activeSub.now}
                    isGroupTesting={isGroupTesting}
                  />
                ))}
              </div>
              {nodes.length === 0 && (
                <div className="text-center text-foreground-400 text-xs py-2">
                  {t('customLines.noProxies')}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

const TabbedGroupPanel = React.memo(TabbedGroupPanelBase, (prevProps, nextProps) => {
  return (
    prevProps.family.length === nextProps.family.length &&
    prevProps.family.every((sub, i) => {
      const next = nextProps.family[i]
      return (
        sub.name === next.name &&
        sub.now === next.now &&
        sub.all === next.all &&
        sub.type === next.type
      )
    }) &&
    prevProps.parentGroup.name === nextProps.parentGroup.name &&
    prevProps.parentGroup.now === nextProps.parentGroup.now &&
    prevProps.parentGroup.testUrl === nextProps.parentGroup.testUrl &&
    prevProps.proxyDisplayMode === nextProps.proxyDisplayMode &&
    prevProps.isGroupTesting === nextProps.isGroupTesting &&
    prevProps.pathKey === nextProps.pathKey
  )
})

TabbedGroupPanel.displayName = 'TabbedGroupPanel'

export default TabbedGroupPanel
