import {
  Avatar,
  Button,
  Card,
  CardBody,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import BaseConfirmModal from '@renderer/components/base/base-confirm-modal'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { FaLocationCrosshairs, FaRegTrashCan, FaEllipsisVertical } from 'react-icons/fa6'
import { CgDetailsLess, CgDetailsMore } from 'react-icons/cg'
import { TbCircleLetterD } from 'react-icons/tb'
import { RxLetterCaseCapitalize } from 'react-icons/rx'
import {
  MdCheck,
  MdDoubleArrow,
  MdFilterAlt,
  MdOutlineSpeed,
  MdVisibilityOff
} from 'react-icons/md'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import { IoIosArrowBack } from 'react-icons/io'
import { useGroups } from '@renderer/hooks/use-groups'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { copyText } from '@renderer/utils/clipboard'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useTranslation } from 'react-i18next'
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2'
import { LuNetwork } from 'react-icons/lu'
import { useCustomLineGroups } from '@renderer/hooks/use-custom-line-groups'
import CustomLineGroupsModal from '@renderer/components/proxies/custom-line-groups-modal'

const GROUP_EXPAND_STATE_KEY = 'proxy_group_expand_state'
const EMPTY_GROUPS: IMihomoMixedGroup[] = []

// 展开区单行: sub 有值 = 子组头行(名称/类型/当前选中); rowNodes 有值 = 节点网格行;
// owner = 该行选中/测速/置顶作用的目标组(直接节点=入口组, 子组节点=子组本身)
interface RenderRow {
  sub?: IMihomoMixedGroup
  rowNodes?: IMihomoProxy[]
  owner?: IMihomoMixedGroup
}

interface GroupExpandState {
  byName: Record<string, boolean>
  legacy?: boolean[]
}

const loadGroupExpandState = (): GroupExpandState => {
  try {
    const savedState = localStorage.getItem(GROUP_EXPAND_STATE_KEY)
    if (!savedState) return { byName: {} }

    const parsed: unknown = JSON.parse(savedState)
    if (Array.isArray(parsed)) {
      return { byName: {}, legacy: parsed.map((isOpen) => isOpen === true) }
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const byName: Record<string, boolean> = {}
      Object.entries(parsed).forEach(([name, isOpen]) => {
        if (typeof isOpen === 'boolean') {
          byName[name] = isOpen
        }
      })
      return { byName }
    }
  } catch (error) {
    console.error('Failed to load group expand state:', error)
  }
  return { byName: {} }
}

function getProviderName(
  proxy: IMihomoProxy | IMihomoGroup | IMihomoMixedGroup
): string | undefined {
  return 'provider-name' in proxy ? proxy['provider-name'] : undefined
}

// 自定义 hook 用于管理展开状态
const useProxyState = (
  groups: IMihomoMixedGroup[] | undefined
): {
  virtuosoRef: React.RefObject<GroupedVirtuosoHandle | null>
  isOpen: boolean[]
  setIsOpen: React.Dispatch<React.SetStateAction<boolean[]>>
} => {
  const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null)
  const [expandState, setExpandState] = useState<GroupExpandState>(loadGroupExpandState)

  const isOpen = useMemo(
    () =>
      groups?.map(
        (group, index) => expandState.byName[group.name] ?? expandState.legacy?.[index] ?? false
      ) ?? [],
    [groups, expandState]
  )

  // 旧数组格式按当前加载的分组顺序迁移一次。
  useEffect(() => {
    if (!groups || expandState.legacy === undefined) return
    setExpandState((prev) => {
      if (prev.legacy === undefined) return prev
      const byName = { ...prev.byName }
      groups.forEach((group, index) => {
        byName[group.name] = prev.legacy?.[index] ?? false
      })
      return { byName }
    })
  }, [groups, expandState.legacy])

  useEffect(() => {
    if (expandState.legacy !== undefined) return
    try {
      localStorage.setItem(GROUP_EXPAND_STATE_KEY, JSON.stringify(expandState.byName))
    } catch (error) {
      console.error('Failed to save group expand state:', error)
    }
  }, [expandState])

  const setIsOpen = useCallback<React.Dispatch<React.SetStateAction<boolean[]>>>(
    (value) => {
      if (!groups) return
      setExpandState((prev) => {
        const current = groups.map(
          (group, index) => prev.byName[group.name] ?? prev.legacy?.[index] ?? false
        )
        const next = typeof value === 'function' ? value(current) : value
        const byName = { ...prev.byName }
        groups.forEach((group, index) => {
          byName[group.name] = next[index] ?? false
        })
        return { byName }
      })
    },
    [groups]
  )

  return {
    virtuosoRef,
    isOpen,
    setIsOpen
  }
}

const Proxies: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups: groupData, mutate, showHidden, setShowHidden } = useGroups()
  const groups = groupData ?? EMPTY_GROUPS
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    proxyDisplayMode = 'simple',
    proxyDisplayOrder = 'default',
    autoCloseConnection = true,
    proxyCols = 'auto',
    delayTestConcurrency = 50
  } = appConfig || {}

  const [cols, setCols] = useState(1)
  const [showLineGroups, setShowLineGroups] = useState(false)
  // 组头快捷删除的目标自定义线路组名(null = 关闭确认弹窗)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // 组头 ⋯ 菜单编辑的目标自定义线路组 id(null = 关闭编辑弹窗)
  const [editGroupId, setEditGroupId] = useState<string | null>(null)
  const { groups: customGroups, saveGroups } = useCustomLineGroups()
  // 自定义线路组 入口组名 -> 专属端口 映射, 供组头端口徽章使用
  const portByGroupName = useMemo(() => {
    const map: Record<string, number> = {}
    for (const g of customGroups ?? []) {
      if (g.name && g.port) map[g.name] = g.port
    }
    return map
  }, [customGroups])
  const { virtuosoRef, isOpen, setIsOpen } = useProxyState(groupData)
  const [delaying, setDelaying] = useState<Set<string>[]>(() =>
    Array.from({ length: groups.length }, () => new Set<string>())
  )
  const [searchValue, setSearchValue] = useState(Array(groups.length).fill(''))

  // searchValue 初始化
  useEffect(() => {
    if (groups.length !== searchValue.length) {
      setSearchValue(Array(groups.length).fill(''))
    }
  }, [groups.length, searchValue.length])

  useEffect(() => {
    setDelaying((prev) => {
      if (prev.length === groups.length) return prev
      return Array.from({ length: groups.length }, (_, i) => prev[i] ?? new Set<string>())
    })
  }, [groups.length])

  // 代理列表排序
  // 成员可能是嵌套子组(递归解析后的 IMihomoMixedGroup),入参放宽到三者联合;
  // 泛型化以保持调用侧类型(分区后节点区只需 IMihomoProxy[])
  const sortProxies = useCallback(
    <T extends IMihomoProxy | IMihomoGroup | IMihomoMixedGroup>(
      proxies: T[],
      order: string
    ): T[] => {
      if (order === 'delay') {
        return [...proxies].sort((a, b) => {
          if (a.history.length === 0) return 1
          if (b.history.length === 0) return -1
          const aDelay = a.history[a.history.length - 1].delay
          const bDelay = b.history[b.history.length - 1].delay
          if (aDelay === 0) return 1
          if (bDelay === 0) return -1
          return aDelay - bDelay
        })
      }
      if (order === 'name') {
        return [...proxies].sort((a, b) => a.name.localeCompare(b.name))
      }
      return proxies
    },
    []
  )

  // 数据分区: 组展开后渲染 直接节点行 + 子组区段(头行 + 该子组节点行)。
  // 修复: 自定义线路组入口组成员全是子组, 旧版把子组一律过滤导致"展开为空"。
  const { groupCounts, allRows, nodeTotals } = useMemo(() => {
    const groupCounts: number[] = []
    const allRows: RenderRow[][] = []
    const nodeTotals: number[] = []

    const nodeVisible = (
      proxy: IMihomoProxy | IMihomoMixedGroup,
      search: string
    ): proxy is IMihomoProxy => {
      if (!proxy || typeof proxy !== 'object' || 'all' in proxy) return false
      if (!includesIgnoreCase(proxy.name, search)) return false
      if (appConfig?.hideUnavailableProxies) {
        if (!proxy.history || proxy.history.length === 0) return true
        const lastDelay = proxy.history[proxy.history.length - 1].delay
        if (lastDelay === 0) return false
      }
      return true
    }

    groups.forEach((group, index) => {
      if (isOpen[index]) {
        const search = searchValue[index] ?? ''
        const rows: RenderRow[] = []
        let total = 0
        // owner = 行内节点选中/测速/置顶作用的目标组; 直接节点归入口组
        const pushNodeRows = (nodes: IMihomoProxy[], owner: IMihomoMixedGroup): void => {
          total += nodes.length
          const sorted = sortProxies(nodes, proxyDisplayOrder)
          for (let i = 0; i < sorted.length; i += cols) {
            rows.push({ rowNodes: sorted.slice(i, i + cols), owner })
          }
        }
        // 直接节点成员(前置): 保持节点在前
        pushNodeRows(
          group.all.filter((p) => nodeVisible(p, search)),
          group
        )
        // 子组成员: 头行 + 该子组的节点行; 搜索时无命中节点的子组整段隐藏
        group.all.forEach((member) => {
          if (!member || typeof member !== 'object' || !('all' in member)) return
          const subNodes = (member.all || []).filter((p) => nodeVisible(p, search))
          if (search && subNodes.length === 0) return
          rows.push({ sub: member })
          pushNodeRows(subNodes, member)
        })
        groupCounts.push(rows.length)
        allRows.push(rows)
        nodeTotals.push(total)
      } else {
        groupCounts.push(0)
        allRows.push([])
        nodeTotals.push(0)
      }
    })
    return { groupCounts, allRows, nodeTotals }
  }, [
    groups,
    isOpen,
    proxyDisplayOrder,
    cols,
    searchValue,
    sortProxies,
    appConfig?.hideUnavailableProxies
  ])

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      if (autoCloseConnection) {
        await mihomoCloseAllConnections()
      }
      mutate()
    },
    [autoCloseConnection, mutate]
  )

  const onProxyDelay = useCallback(
    async (proxy: IMihomoProxy | IMihomoGroup, url?: string): Promise<IMihomoDelay> => {
      return await mihomoProxyDelay(proxy.name, url, getProviderName(proxy))
    },
    []
  )

  // 组测速时逐节点写回会造成 O(N²) 分配与 N 次 allProxies 重算
  const pendingDelayResults = useRef<Map<string, Map<string, { time: string; delay: number }>>>(
    new Map()
  )
  const pendingDelayDone = useRef<Map<number, Set<string>>>(new Map())
  const flushDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDelayResults = useCallback((): void => {
    if (flushDelayTimer.current) {
      clearTimeout(flushDelayTimer.current)
      flushDelayTimer.current = null
    }
    const results = pendingDelayResults.current
    const done = pendingDelayDone.current
    if (results.size === 0 && done.size === 0) return

    // 把 ref 换成新的空容器，updater 只读这份脱离 ref 的快照
    pendingDelayResults.current = new Map()
    pendingDelayDone.current = new Map()

    if (results.size > 0) {
      mutate(
        (current) => {
          if (!current) return current
          let changed = false
          // 递归写回: 组测速含子组节点(自定义线路组), 嵌套层级里也要更新 history
          const mapAll = (
            all: (IMihomoProxy | IMihomoMixedGroup)[],
            groupResults: Map<string, { time: string; delay: number }>
          ): (IMihomoProxy | IMihomoMixedGroup)[] => {
            let groupChanged = false
            const next = all.map((p) => {
              const entry = p && groupResults.get(p.name)
              if (entry) {
                groupChanged = true
                return { ...p, history: [...p.history, entry] }
              }
              if (p && 'all' in p && Array.isArray(p.all)) {
                const subAll = mapAll(p.all, groupResults)
                if (subAll !== p.all) {
                  groupChanged = true
                  return { ...p, all: subAll }
                }
              }
              return p
            })
            return groupChanged ? next : all
          }
          const next = current.map((group) => {
            const groupResults = results.get(group.name)
            if (!groupResults || groupResults.size === 0) return group
            const all = mapAll(group.all, groupResults)
            if (all === group.all) return group
            changed = true
            return { ...group, all }
          })
          return changed ? next : current
        },
        { revalidate: false }
      )
    }

    if (done.size > 0) {
      setDelaying((prev) => {
        let changed = false
        const next = [...prev]
        done.forEach((names, idx) => {
          const set = next[idx]
          if (!set) return
          const newSet = new Set(set)
          let localChanged = false
          names.forEach((name) => {
            if (newSet.delete(name)) localChanged = true
          })
          if (localChanged) {
            next[idx] = newSet
            changed = true
          }
        })
        return changed ? next : prev
      })
    }
  }, [mutate])

  const scheduleFlushDelayResults = useCallback((): void => {
    if (flushDelayTimer.current) return
    flushDelayTimer.current = setTimeout(flushDelayResults, 200)
  }, [flushDelayResults])

  useEffect(() => {
    return (): void => {
      if (flushDelayTimer.current) {
        clearTimeout(flushDelayTimer.current)
        flushDelayTimer.current = null
      }
    }
  }, [])

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      // 测试目标 = 展开区全部节点(直接成员 + 子组成员)
      const testTargets = allRows[index]?.flatMap((r) => r.rowNodes ?? []) ?? []
      if (testTargets.length === 0) {
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }
      const proxyNames = testTargets.map((p) => p.name)
      setDelaying((prev) => {
        const next = [...prev]
        next[index] = new Set(proxyNames)
        return next
      })

      // 限制并发数量
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of testTargets) {
        const promise = Promise.resolve().then(async () => {
          let res: IMihomoDelay | undefined
          try {
            res = await mihomoProxyDelay(proxy.name, groups[index].testUrl, getProviderName(proxy))
          } catch {
            // ignore
          }
          const groupName = groups[index].name
          let groupResults = pendingDelayResults.current.get(groupName)
          if (!groupResults) {
            groupResults = new Map()
            pendingDelayResults.current.set(groupName, groupResults)
          }
          groupResults.set(proxy.name, {
            time: new Date().toISOString(),
            delay: res?.delay ?? 0
          })

          let groupDone = pendingDelayDone.current.get(index)
          if (!groupDone) {
            groupDone = new Set()
            pendingDelayDone.current.set(index, groupDone)
          }
          groupDone.add(proxy.name)

          scheduleFlushDelayResults()
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }
      await Promise.all(result)
      flushDelayResults()
    },
    [allRows, groups, delayTestConcurrency, scheduleFlushDelayResults, flushDelayResults, setIsOpen]
  )

  const calcCols = useCallback(
    (containerWidth: number): number => {
      if (proxyCols !== 'auto') {
        return parseInt(proxyCols)
      }
      // 按列表容器实测宽度换算列数(而非视口): 侧栏/嵌套缩进导致的实际可用宽度
      // 与视口断点脱节, 用容器宽保证虚拟分页 cols 与渲染列严格一致
      if (containerWidth >= 1536) return 5
      if (containerWidth >= 1280) return 4
      if (containerWidth >= 1024) return 3
      return 2
    },
    [proxyCols]
  )

  // ResizeObserver 实测代理列表容器宽度 → 自适应分列
  const listContainerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = listContainerRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      // 兜底: 无 ResizeObserver 环境退回视口宽度
      setCols(calcCols(window.innerWidth))
      const onWinResize = (): void => setCols(calcCols(window.innerWidth))
      window.addEventListener('resize', onWinResize)
      return (): void => window.removeEventListener('resize', onWinResize)
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setCols(calcCols(width))
    })
    observer.observe(element)
    return (): void => observer.disconnect()
  }, [calcCols])

  const renderGroupContent = useCallback(
    (index: number) => {
      if (
        groups[index]?.icon &&
        groups[index].icon.startsWith('http') &&
        !localStorage.getItem(groups[index].icon)
      ) {
        getImageDataURL(groups[index].icon)
          .then((dataURL) => {
            localStorage.setItem(groups[index].icon, dataURL)
            mutate()
          })
          .catch(() => {})
      }
      return groups[index] ? (
        <div
          className={`w-full pt-2 ${index === groupCounts.length - 1 && !isOpen[index] ? 'pb-2' : ''} px-2`}
        >
          <Card
            as="div"
            isPressable
            fullWidth
            onPress={() => {
              setIsOpen((prev) => {
                const newOpen = [...prev]
                newOpen[index] = !prev[index]
                return newOpen
              })
            }}
          >
            <CardBody className="w-full h-14">
              <div className="flex justify-between h-full gap-3">
                <div className="flex min-w-0 h-full text-ellipsis overflow-hidden whitespace-nowrap">
                  {groups[index].icon ? (
                    <Avatar
                      className="bg-transparent mr-2 shrink-0"
                      size="sm"
                      radius="sm"
                      src={
                        groups[index].icon.startsWith('<svg')
                          ? `data:image/svg+xml;utf8,${groups[index].icon}`
                          : localStorage.getItem(groups[index].icon) || groups[index].icon
                      }
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-col h-full">
                    <div className="text-ellipsis overflow-hidden whitespace-nowrap leading-tight text-md flex-5 flex items-center">
                      <span title={groups[index].name} className="flag-emoji inline-block truncate">
                        {groups[index].name}
                      </span>
                      {/* 自定义线路组入口: 显示该组专属端口徽章, 点击复制完整代理地址 */}
                      {portByGroupName[groups[index].name] && (
                        <Chip
                          size="sm"
                          variant="flat"
                          color="primary"
                          className="ml-1 text-primary cursor-pointer shrink-0"
                          title={`${t('customLines.port')}: ${portByGroupName[groups[index].name]} | ${t('proxies.portCopyTip')}`}
                          onClick={(e) => {
                            // 阻止冒泡: 组头点击是折叠/展开, 徽章点击是复制
                            e.stopPropagation()
                            const host = location.hostname || '127.0.0.1'
                            const addr = `${host}:${portByGroupName[groups[index].name]}`
                            void copyText(addr)
                              .then(() => toast.success(t('proxies.portCopied', { addr })))
                              .catch(() => toast.error(t('common.error.copyFailed')))
                          }}
                        >
                          {t('customLines.port')}:{' '}
                          <span className="font-semibold tabular-nums">
                            {portByGroupName[groups[index].name]}
                          </span>
                        </Chip>
                      )}
                    </div>
                    <div className="text-ellipsis overflow-hidden whitespace-nowrap text-[10px] text-foreground-500 leading-tight flex-3 flex items-center">
                      <span>{groups[index].type}</span>
                      <span
                        title={groups[index].now}
                        className="flag-emoji ml-1 inline-block truncate"
                      >
                        {groups[index].now}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <div
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {proxyDisplayMode === 'full' && (
                      <Chip size="sm" className="my-1 mr-2">
                        {nodeTotals[index]}
                      </Chip>
                    )}
                    <CollapseInput
                      title={t('proxies.search.placeholder')}
                      value={searchValue[index]}
                      onValueChange={(v) => {
                        setSearchValue((prev) => {
                          const newSearchValue = [...prev]
                          newSearchValue[index] = v
                          return newSearchValue
                        })
                      }}
                    />
                    <Button
                      title={t('proxies.locate')}
                      variant="light"
                      size="sm"
                      isIconOnly
                      onPress={() => {
                        if (!isOpen[index]) {
                          setIsOpen((prev) => {
                            const newOpen = [...prev]
                            newOpen[index] = true
                            return newOpen
                          })
                        }
                        let i = 0
                        for (let j = 0; j < index; j++) {
                          i += groupCounts[j]
                        }
                        // 当前选中是节点 → 定位到该节点所在行(含子组区段);
                        // 选中的是子组(仅头行展示)或未找到 → 停在组头
                        const rows = allRows[index] ?? []
                        const nodeIdx = rows.findIndex((row) =>
                          row.rowNodes?.some((p) => p.name === groups[index].now)
                        )
                        if (nodeIdx >= 0) i += nodeIdx
                        virtuosoRef.current?.scrollToIndex({
                          index: Math.floor(i),
                          align: 'start'
                        })
                      }}
                    >
                      <FaLocationCrosshairs className="text-lg text-foreground-500" />
                    </Button>
                    <Button
                      title={t('proxies.delay.test')}
                      variant="light"
                      isLoading={(delaying[index]?.size ?? 0) > 0}
                      size="sm"
                      isIconOnly
                      onPress={() => {
                        onGroupDelay(index)
                      }}
                    >
                      <MdOutlineSpeed className="text-lg text-foreground-500" />
                    </Button>
                    {/* 自定义线路组: 组头 ⋯ 扩展菜单(编辑信息) + 快捷删除(确认后删组与端口) */}
                    {portByGroupName[groups[index].name] && (
                      <Dropdown placement="bottom-end">
                        <DropdownTrigger>
                          <Button
                            title={t('customLines.more')}
                            variant="light"
                            size="sm"
                            isIconOnly
                          >
                            <FaEllipsisVertical className="text-lg text-foreground-500" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label={t('customLines.more')}
                          className="min-w-40 p-1"
                          onAction={(key) => {
                            if (key === 'edit') {
                              const g = (customGroups ?? []).find(
                                (x) => x.name === groups[index].name
                              )
                              if (g) setEditGroupId(g.id)
                            }
                          }}
                        >
                          <DropdownItem key="edit">{t('customLines.editInfo')}</DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    )}
                    {portByGroupName[groups[index].name] && (
                      <Button
                        title={t('customLines.deleteTitle')}
                        variant="light"
                        size="sm"
                        isIconOnly
                        className="group"
                        onPress={() => setDeleteTarget(groups[index].name)}
                      >
                        <FaRegTrashCan className="text-lg text-foreground-500 transition-colors group-hover:text-danger" />
                      </Button>
                    )}
                  </div>
                  <IoIosArrowBack
                    className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 ${isOpen[index] ? '-rotate-90' : ''}`}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      groups,
      groupCounts,
      isOpen,
      proxyDisplayMode,
      t,
      searchValue,
      delaying,
      mutate,
      setIsOpen,
      nodeTotals,
      virtuosoRef,
      onGroupDelay,
      portByGroupName,
      allRows,
      customGroups
    ]
  )

  const renderItemContent = useCallback(
    (index: number, groupIndex: number) => {
      const row = allRows[groupIndex]?.[index]
      if (!row) {
        return <div>Never See This</div>
      }
      // 子组区段头行: 展示 子组名/类型/当前选中, 非交互(选节点仍通过网格行)
      if (row.sub) {
        const sub = row.sub
        const isLastRow =
          groupIndex === groupCounts.length - 1 && index === groupCounts[groupIndex] - 1
        return (
          <div className={`flex items-center gap-2 px-3 pt-3 ${isLastRow ? 'pb-2' : ''}`}>
            <Chip size="sm" variant="flat" color="primary" className="max-w-[40%]">
              <span className="flag-emoji truncate inline-block" title={sub.name}>
                {sub.name}
              </span>
            </Chip>
            <span className="text-foreground-500 text-xs shrink-0">{sub.type}</span>
            <span className="text-foreground-400 text-xs truncate" title={sub.now}>
              → {sub.now}
            </span>
          </div>
        )
      }
      const nodes = row.rowNodes ?? []
      // 选中/置顶/测速作用于归属组: 子组区段的节点对子组操作(url-test 组无手选, 点击仅刷新)
      const owner = row.owner ?? groups[groupIndex]
      const isLastRow =
        groupIndex === groupCounts.length - 1 && index === groupCounts[groupIndex] - 1
      return (
        <div
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} ${isLastRow ? 'pb-2' : ''} gap-2 pt-2 mx-2`}
        >
          {nodes.map((item) => (
            <ProxyItem
              key={item.name}
              mutateProxies={mutate}
              onProxyDelay={onProxyDelay}
              onSelect={onChangeProxy}
              proxy={item}
              group={owner}
              proxyDisplayMode={proxyDisplayMode}
              selected={item.name === owner.now}
              isGroupTesting={delaying[groupIndex]?.has(item.name) ?? false}
            />
          ))}
        </div>
      )
    },
    [
      groupCounts,
      allRows,
      proxyCols,
      groups,
      proxyDisplayMode,
      delaying,
      mutate,
      onProxyDelay,
      onChangeProxy
    ]
  )

  return (
    <BasePage
      title={t('proxies.title')}
      header={
        <>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            title={t('customLines.title')}
            onPress={() => setShowLineGroups(true)}
          >
            <LuNetwork className="text-lg" />
          </Button>
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button size="sm" isIconOnly variant="light" title={t('proxies.settings')}>
                <HiOutlineAdjustmentsHorizontal className="text-lg" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={t('proxies.settings')}
              className="min-w-64 p-1"
              onAction={(key) => {
                switch (key) {
                  case 'show-hidden':
                    setShowHidden((prev) => !prev)
                    break
                  case 'hide-unavailable':
                    void patchAppConfig({
                      hideUnavailableProxies: !appConfig?.hideUnavailableProxies
                    })
                    break
                  case 'order-default':
                    void patchAppConfig({ proxyDisplayOrder: 'default' })
                    break
                  case 'order-delay':
                    void patchAppConfig({ proxyDisplayOrder: 'delay' })
                    break
                  case 'order-name':
                    void patchAppConfig({ proxyDisplayOrder: 'name' })
                    break
                  case 'mode-simple':
                    void patchAppConfig({ proxyDisplayMode: 'simple' })
                    break
                  case 'mode-full':
                    void patchAppConfig({ proxyDisplayMode: 'full' })
                    break
                }
              }}
            >
              <DropdownSection title={t('proxies.settings.visibility')} showDivider>
                <DropdownItem
                  key="show-hidden"
                  startContent={<MdFilterAlt className="text-lg" />}
                  endContent={showHidden ? <MdCheck className="text-lg text-primary" /> : null}
                >
                  {t(showHidden ? 'proxies.hiddenGroups.hide' : 'proxies.hiddenGroups.show')}
                </DropdownItem>
                <DropdownItem
                  key="hide-unavailable"
                  startContent={<MdVisibilityOff className="text-lg" />}
                  endContent={
                    appConfig?.hideUnavailableProxies ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t(
                    appConfig?.hideUnavailableProxies
                      ? 'proxies.hideUnavailable.enabled'
                      : 'proxies.hideUnavailable.disabled'
                  )}
                </DropdownItem>
              </DropdownSection>
              <DropdownSection title={t('proxies.settings.order')} showDivider>
                <DropdownItem
                  key="order-default"
                  startContent={<TbCircleLetterD className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'default' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.default')}
                </DropdownItem>
                <DropdownItem
                  key="order-delay"
                  startContent={<MdOutlineSpeed className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'delay' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.delay')}
                </DropdownItem>
                <DropdownItem
                  key="order-name"
                  startContent={<RxLetterCaseCapitalize className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'name' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.name')}
                </DropdownItem>
              </DropdownSection>
              <DropdownSection title={t('proxies.settings.mode')}>
                <DropdownItem
                  key="mode-simple"
                  startContent={<CgDetailsLess className="text-lg" />}
                  endContent={
                    proxyDisplayMode === 'simple' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.mode.simple')}
                </DropdownItem>
                <DropdownItem
                  key="mode-full"
                  startContent={<CgDetailsMore className="text-lg" />}
                  endContent={
                    proxyDisplayMode === 'full' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.mode.full')}
                </DropdownItem>
              </DropdownSection>
            </DropdownMenu>
          </Dropdown>
        </>
      }
    >
      {mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center">
            <MdDoubleArrow className="text-foreground-500 text-[100px]" />
            <h2 className="text-foreground-500 text-[20px]">{t('proxies.mode.direct')}</h2>
          </div>
        </div>
      ) : (
        <div className="h-[calc(100vh-50px)]" ref={listContainerRef}>
          <GroupedVirtuoso
            ref={virtuosoRef}
            groupCounts={groupCounts}
            defaultItemHeight={80}
            increaseViewportBy={{ top: 150, bottom: 150 }}
            overscan={200}
            computeItemKey={(index, groupIndex) => `${groupIndex}-${index}`}
            groupContent={renderGroupContent}
            itemContent={renderItemContent}
          />
        </div>
      )}
      <CustomLineGroupsModal
        isOpen={showLineGroups}
        onClose={() => setShowLineGroups(false)}
        groups={customGroups ?? []}
        onSave={saveGroups}
      />
      {/* 组头 ⋯ 菜单编辑入口: 单组编辑弹窗(改端口/名字/模式/线路, 保存按 id 合并回全量) */}
      <CustomLineGroupsModal
        isOpen={editGroupId !== null}
        onClose={() => setEditGroupId(null)}
        groups={customGroups ?? []}
        onSave={saveGroups}
        editGroupId={editGroupId}
      />
      {/* 组头快捷删除确认: 删除该自定义线路组及其专属端口 */}
      {deleteTarget && (
        <BaseConfirmModal
          isOpen={Boolean(deleteTarget)}
          title={t('customLines.deleteTitle')}
          content={t('customLines.deleteConfirm', {
            name: deleteTarget,
            port: portByGroupName[deleteTarget]
          })}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const name = deleteTarget
            setDeleteTarget(null)
            void saveGroups((customGroups ?? []).filter((g) => g.name !== name)).then((ok) => {
              if (ok) toast.success(t('customLines.deleteSuccess', { name }))
            })
          }}
        />
      )}
    </BasePage>
  )
}

export default Proxies
