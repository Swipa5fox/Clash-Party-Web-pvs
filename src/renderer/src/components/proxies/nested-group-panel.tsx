import { Button, Card, CardBody, Chip } from '@heroui/react'
import React, { useMemo, useState, useCallback } from 'react'
import { IoIosArrowBack } from 'react-icons/io'
import { MdOutlineSpeed } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { KeyedMutator } from 'swr'
import ProxyItem from './proxy-item'
import TabbedGroupPanel, { splitUniformLineFamily } from './tabbed-group-panel'

// 嵌套面板展开状态记在模块级 Map:GroupedVirtuoso 虚拟滚动会卸载组件,从 Map 恢复。
// key 用「父组::子组[::孙组…]」组名路径,不同父组下的同名子组状态互不影响。
const panelOpenState = new Map<string, boolean>()

interface Props {
  mutateProxies: KeyedMutator<IMihomoMixedGroup[]>
  onProxyDelay: (proxy: IMihomoProxy | IMihomoGroup, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  // 注意类型: 主进程 mihomoGroups 会把成员递归解析成对象, 所以这里拿到的是
  // IMihomoMixedGroup(all 为对象数组) 而不是 IMihomoGroup(all 为名字字符串数组)。
  // 用错类型写 'all' in member 会在运行时对字符串求 in → TypeError 卡死页面。
  subproxy: IMihomoMixedGroup
  // 语义分层: 点面板头 = 让 parentGroup 选中 subproxy;
  // 面板内节点点击 = 让 subproxy 自身选中该节点(见下方 group 归一)。
  parentGroup: IMihomoMixedGroup
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  isGroupTesting?: boolean
  // 展开状态 key,由调用方拼接 `父组::子组[::孙组…]`
  pathKey: string
  // 嵌套层级,用于内层缩进样式
  depth?: number
}

const SUBGROUP_TYPE_LABEL: Record<string, string> = {
  Selector: '手动',
  URLTest: '自动',
  Fallback: '故障',
  LoadBalance: '负载'
}

const NestedGroupPanelBase: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const {
    mutateProxies,
    proxyDisplayMode,
    subproxy,
    parentGroup,
    selected,
    onSelect,
    onProxyDelay,
    isGroupTesting = false,
    pathKey,
    depth = 0
  } = props

  const [open, setOpen] = useState(() => panelOpenState.get(pathKey) ?? false)
  const [delayingAll, setDelayingAll] = useState(false)

  const toggleOpen = useCallback((): void => {
    setOpen((prev) => {
      panelOpenState.set(pathKey, !prev)
      return !prev
    })
  }, [pathKey])

  // 成员分区: 嵌套子组(递归渲染面板)与直接节点(渲染网格)
  const subGroups = useMemo(
    () => subproxy.all.filter((p): p is IMihomoMixedGroup => 'all' in p),
    [subproxy.all]
  )
  const nodes = useMemo(
    () => subproxy.all.filter((p): p is IMihomoProxy => !('all' in p)),
    [subproxy.all]
  )

  // 组测速: 批量测当前子组的直接节点(深层子组由各层面板自行测)
  const testAllDelay = useCallback((): void => {
    setDelayingAll(true)
    Promise.allSettled(nodes.map((node) => onProxyDelay(node, parentGroup.testUrl))).finally(() => {
      mutateProxies()
      setDelayingAll(false)
    })
  }, [nodes, parentGroup.testUrl, onProxyDelay, mutateProxies])

  const typeLabel = useMemo(
    () => SUBGROUP_TYPE_LABEL[subproxy.type] ?? subproxy.type,
    [subproxy.type]
  )

  // 去掉与前缀重复的部分显示,如 "AU·自动" 在 AU 组下显示 "自动"
  const displayName = useMemo(() => {
    const parentPrefix = parentGroup.name.split('·')[0]
    return subproxy.name.startsWith(parentPrefix + '·')
      ? subproxy.name.slice(parentPrefix.length + 1)
      : subproxy.name
  }, [subproxy.name, parentGroup.name])

  return (
    <div className="w-full">
      <Card
        as="div"
        isPressable
        fullWidth
        shadow="sm"
        radius="sm"
        className={selected ? 'bg-primary/30 border-r-2 border-r-primary border-l-2 border-l-primary' : 'bg-content2'}
        onPress={() => onSelect(parentGroup.name, subproxy.name)}
      >
        <CardBody className="p-1">
          <div className="flex justify-between items-center pl-1 gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <Chip size="sm" variant="flat" className="h-5 text-[10px] shrink-0">
                {typeLabel}
              </Chip>
              <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                <div className={`flag-emoji inline ${depth > 0 ? 'text-xs' : 'text-sm'}`} title={subproxy.name}>
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
      {/* 展开内容: 左竖线缩进引导嵌套层级,子组面板全宽纵向排列,直接节点用内部网格
          (嵌套层视觉密度更高,断点列数与顶层一致但 gap 更小) */}
      {open && (
        <div className="flex flex-col gap-1 mt-1 ml-2 pl-2 border-l border-divider">
          {/* 同线路子组族(如自动/故障/手动/全局)合并为一个 tab 容器,避免多个大面板 */}
          {(() => {
            const { family, rest } = splitUniformLineFamily(subGroups)
            return (
              <>
                {family && (
                  <TabbedGroupPanel
                    family={family}
                    parentGroup={{ ...subproxy }}
                    mutateProxies={mutateProxies}
                    onProxyDelay={onProxyDelay}
                    onSelect={onSelect}
                    proxyDisplayMode={proxyDisplayMode}
                    isGroupTesting={isGroupTesting}
                    pathKey={`${pathKey}::${family[0].name}`}
                  />
                )}
                {rest.map((sub) => (
                  <NestedGroupPanel
                    key={sub.name}
                    mutateProxies={mutateProxies}
                    onProxyDelay={onProxyDelay}
                    onSelect={onSelect}
                    subproxy={sub}
                    // 内层面板头点击 = 让当前层 subproxy 选中该内层子组
                    parentGroup={{ ...subproxy }}
                    pathKey={`${pathKey}::${sub.name}`}
                    proxyDisplayMode={proxyDisplayMode}
                    selected={sub.name === subproxy.now}
                    isGroupTesting={isGroupTesting}
                    depth={depth + 1}
                  />
                ))}
              </>
            )
          })()}
          {nodes.length > 0 && (
            <div className="@container">
              <div className="grid gap-1 grid-cols-1 @2xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
                {nodes.map((node) => (
                  <ProxyItem
                    key={node.name}
                    mutateProxies={mutateProxies}
                    onProxyDelay={onProxyDelay}
                    onSelect={onSelect}
                    proxy={node}
                    // 面板内节点选择目标是子组本身(如 AU·手动 -> 节点),fixed 归一避免父组固定态误染
                    group={{ ...subproxy, fixed: undefined } as IMihomoMixedGroup}
                    proxyDisplayMode={proxyDisplayMode}
                    selected={node.name === subproxy.now}
                    isGroupTesting={isGroupTesting}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const NestedGroupPanel = React.memo(NestedGroupPanelBase, (prevProps, nextProps) => {
  // pathKey 同层恒定,depth 由路径推导,均无需参与 name/now 之外的额外比较
  return (
    prevProps.subproxy.name === nextProps.subproxy.name &&
    prevProps.subproxy.now === nextProps.subproxy.now &&
    prevProps.subproxy.all === nextProps.subproxy.all &&
    prevProps.selected === nextProps.selected &&
    prevProps.proxyDisplayMode === nextProps.proxyDisplayMode &&
    prevProps.isGroupTesting === nextProps.isGroupTesting &&
    prevProps.pathKey === nextProps.pathKey
  )
})

NestedGroupPanel.displayName = 'NestedGroupPanel'

export default NestedGroupPanel
