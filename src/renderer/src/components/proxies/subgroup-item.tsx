import { Button, Card, CardBody, Chip } from '@heroui/react'
import React, { useMemo, useState, useCallback } from 'react'
import { IoIosArrowBack } from 'react-icons/io'
import { MdOutlineSpeed } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { KeyedMutator } from 'swr'
import ProxyItem from './proxy-item'

// 子组展开状态记在模块级 Map:GroupedVirtuoso 虚拟滚动会卸载组件,从 Map 恢复
const subgroupOpenState = new Map<string, boolean>()

interface Props {
  mutateProxies: KeyedMutator<IMihomoMixedGroup[]>
  onProxyDelay: (proxy: IMihomoProxy | IMihomoGroup, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  // 注意类型: 主进程 mihomoGroups 会把成员递归解析成对象, 所以这里拿到的是
  // IMihomoMixedGroup(all 为对象数组) 而不是 IMihomoGroup(all 为名字字符串数组)。
  // 用错类型写 'all' in member 会在运行时对字符串求 in → TypeError 卡死页面。
  subproxy: IMihomoMixedGroup
  group: IMihomoMixedGroup
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  isGroupTesting?: boolean
}

const SUBGROUP_TYPE_LABEL: Record<string, string> = {
  Selector: '手动',
  URLTest: '自动',
  Fallback: '故障',
  LoadBalance: '负载'
}

const SubgroupItemBase: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const {
    mutateProxies,
    proxyDisplayMode,
    subproxy,
    group,
    selected,
    onSelect,
    onProxyDelay,
    isGroupTesting = false
  } = props

  const [open, setOpen] = useState(() => subgroupOpenState.get(subproxy.name) ?? false)
  const [delayingAll, setDelayingAll] = useState(false)

  const toggleOpen = useCallback((): void => {
    setOpen((prev) => {
      subgroupOpenState.set(subproxy.name, !prev)
      return !prev
    })
  }, [subproxy.name])

  // 子组内节点选择:目标是子组本身(如 AU·手动 -> 节点)
  const onSelectNode = useCallback(
    (groupName: string, proxyName: string): void => {
      onSelect(groupName, proxyName)
    },
    [onSelect]
  )

  const testAllDelay = useCallback((): void => {
    setDelayingAll(true)
    const nodes = subproxy.all.filter((p): p is IMihomoProxy => !('all' in p))
    Promise.allSettled(nodes.map((node) => onProxyDelay(node, group.testUrl))).finally(() => {
      mutateProxies()
      setDelayingAll(false)
    })
  }, [subproxy, group.testUrl, onProxyDelay, mutateProxies])

  const typeLabel = useMemo(
    () => SUBGROUP_TYPE_LABEL[subproxy.type] ?? subproxy.type,
    [subproxy.type]
  )

  // 去掉与前缀重复的部分显示,如 "AU·自动" 在 AU 卡片下显示 "自动"
  const displayName = useMemo(() => {
    const parentPrefix = group.name.split('·')[0]
    return subproxy.name.startsWith(parentPrefix + '·')
      ? subproxy.name.slice(parentPrefix.length + 1)
      : subproxy.name
  }, [subproxy.name, group.name])

  return (
    <div className="w-full">
      <Card
        as="div"
        isPressable
        fullWidth
        shadow="sm"
        radius="sm"
        className={selected ? 'bg-primary/30 border-r-2 border-r-primary border-l-2 border-l-primary' : 'bg-content2'}
        onPress={() => onSelect(group.name, subproxy.name)}
      >
        <CardBody className="p-1">
          <div className="flex justify-between items-center pl-1 gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <Chip size="sm" variant="flat" className="h-5 text-[10px] shrink-0">
                {typeLabel}
              </Chip>
              <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                <div className="flag-emoji inline text-sm" title={subproxy.name}>
                  {displayName}
                </div>
              </div>
              <div
                className="text-foreground-400 text-[10px] text-ellipsis overflow-hidden whitespace-nowrap max-w-[40%]"
                title={subproxy.now}
              >
                <span className="flag-emoji inline">{subproxy.now}</span>
              </div>
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
        </CardBody>
      </Card>
      {/* 展开的节点列表用单列: 外层是 2~5 列网格, 子组只占其中一格,
          里面再用视口断点分列会把卡片挤到 ~70px */}
      {open && (
        <div className="flex flex-col gap-1 mt-1 ml-2 pl-2 border-l border-divider">
          {subproxy.all.map((node) =>
            'all' in node ? null : (
              <ProxyItem
                key={node.name}
                mutateProxies={mutateProxies}
                onProxyDelay={onProxyDelay}
                onSelect={onSelectNode}
                proxy={node}
                group={{ ...group, name: subproxy.name, fixed: undefined } as IMihomoMixedGroup}
                proxyDisplayMode={proxyDisplayMode}
                selected={node.name === subproxy.now}
                isGroupTesting={isGroupTesting}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

const SubgroupItem = React.memo(SubgroupItemBase, (prevProps, nextProps) => {
  return (
    prevProps.subproxy.name === nextProps.subproxy.name &&
    prevProps.subproxy.now === nextProps.subproxy.now &&
    prevProps.subproxy.all === nextProps.subproxy.all &&
    prevProps.selected === nextProps.selected &&
    prevProps.proxyDisplayMode === nextProps.proxyDisplayMode &&
    prevProps.isGroupTesting === nextProps.isGroupTesting
  )
})

SubgroupItem.displayName = 'SubgroupItem'

export default SubgroupItem
