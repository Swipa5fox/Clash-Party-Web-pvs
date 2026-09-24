import { useTheme } from 'next-themes'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { NavigateFunction, useLocation, useNavigate, useRoutes } from 'react-router-dom'
import { Button, Divider } from '@heroui/react'
import { IoSettings } from 'react-icons/io5'
import routes from '@renderer/routes'
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  Modifier,
  CollisionDetection
} from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import ProfileCard from '@renderer/components/sider/profile-card'
import ProxyCard from '@renderer/components/sider/proxy-card'
import RuleCard from '@renderer/components/sider/rule-card'
import DNSCard from '@renderer/components/sider/dns-card'
import SniffCard from '@renderer/components/sider/sniff-card'
import OverrideCard from '@renderer/components/sider/override-card'
import ConnCard from '@renderer/components/sider/conn-card'
import LogCard from '@renderer/components/sider/log-card'
import MihomoCoreCard from '@renderer/components/sider/mihomo-core-card'
import ResourceCard from '@renderer/components/sider/resource-card'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { applyTheme, setNativeTheme } from '@renderer/utils/ipc'
import NetworkCard from '@renderer/components/sider/network-card'
import UsageCard from '@renderer/components/sider/usage-card'
import FileShareCard from '@renderer/components/sider/file-share-card'
import { useTrafficLogger } from '@renderer/hooks/use-traffic-logger'
import { createTourDriver, getDriver, startTourIfNeeded } from '@renderer/utils/tour'
import 'driver.js/dist/driver.css'
import { useTranslation } from 'react-i18next'
import { DEFAULT_ENABLE_TRAFFIC_LOGGER, DEFAULT_SIDER_ORDER } from '../../shared/appConfig'
import MihomoIcon from './components/base/mihomo-icon'
import { SIDER_CARD_ROUTES, getSiderCardByPath, mergeSiderOrder } from './utils/sider'

export { getDriver }

const App: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const hasAppConfig = Boolean(appConfig)
  const {
    enableTrafficLogger = DEFAULT_ENABLE_TRAFFIC_LOGGER,
    appTheme = 'system',
    customTheme,
    siderWidth = 250,
    siderOrder = DEFAULT_SIDER_ORDER,
    lastSelectedSiderCard = 'proxy',
    rememberSelectedSiderCard = false,
    lockSiderCards = false
  } = appConfig || {}
  useTrafficLogger(enableTrafficLogger)
  const narrowWidth = 60
  const [order, setOrder] = useState<SiderCardKey[]>(mergeSiderOrder(siderOrder))
  const [siderWidthValue, setSiderWidthValue] = useState(siderWidth)
  const siderWidthValueRef = useRef(siderWidthValue)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(resizing)
  const tourInitialized = useRef(false)
  const sensors = useSensors(useSensor(PointerSensor))
  const { setTheme, systemTheme } = useTheme()
  const navigate: NavigateFunction = useNavigate()
  const location = useLocation()
  const page = useRoutes(routes)

  useEffect(() => {
    setOrder(mergeSiderOrder(siderOrder))
    setSiderWidthValue(siderWidth)
  }, [siderOrder, siderWidth])

  useEffect(() => {
    if (!hasAppConfig) return
    if (!rememberSelectedSiderCard) return
    const currentSiderCard = getSiderCardByPath(location.pathname)
    if (!currentSiderCard || currentSiderCard === lastSelectedSiderCard) return
    patchAppConfig({ lastSelectedSiderCard: currentSiderCard })
  }, [
    hasAppConfig,
    rememberSelectedSiderCard,
    lastSelectedSiderCard,
    location.pathname,
    patchAppConfig
  ])

  useEffect(() => {
    siderWidthValueRef.current = siderWidthValue
    resizingRef.current = resizing
  }, [siderWidthValue, resizing])

  const onResizeEnd = useCallback((): void => {
    if (resizingRef.current) {
      setResizing(false)
      patchAppConfig({ siderWidth: siderWidthValueRef.current })
    }
  }, [patchAppConfig])

  useEffect(() => {
    if (!tourInitialized.current) {
      tourInitialized.current = true
      createTourDriver(t, navigate)
      startTourIfNeeded()
    }
  }, [t, navigate])

  useEffect(() => {
    setNativeTheme(appTheme)
    setTheme(appTheme)
  }, [appTheme, systemTheme, setTheme])

  useEffect(() => {
    applyTheme(customTheme || 'default.css')
  }, [customTheme])

  useEffect(() => {
    window.addEventListener('mouseup', onResizeEnd)
    return (): void => window.removeEventListener('mouseup', onResizeEnd)
  }, [onResizeEnd])

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    const activeId = active.id as SiderCardKey
    if (over && !lockSiderCards) {
      if (active.id !== over.id) {
        const overId = over.id as SiderCardKey
        const newOrder = order.slice()
        const activeIndex = newOrder.indexOf(activeId)
        const overIndex = newOrder.indexOf(overId)
        if (activeIndex === -1 || overIndex === -1) return
        newOrder.splice(activeIndex, 1)
        newOrder.splice(overIndex, 0, activeId)
        setOrder(newOrder)
        await patchAppConfig({ siderOrder: newOrder })
        return
      }
    }
    const dest = SIDER_CARD_ROUTES[activeId]
    if (dest) navigate(dest)
  }

  const lockTransform: Modifier = (args) => {
    if (lockSiderCards) return { ...args.transform, x: 0, y: 0 }
    return args.transform
  }

  const collisionDetection: CollisionDetection = (args) => {
    if (lockSiderCards) return []
    return closestCorners(args)
  }

  const componentMap: Record<SiderCardKey, React.FC<{ iconOnly?: boolean }>> = {
    profile: ProfileCard,
    proxy: ProxyCard,
    mihomo: MihomoCoreCard,
    connection: ConnCard,
    dns: DNSCard,
    sniff: SniffCard,
    log: LogCard,
    rule: RuleCard,
    resource: ResourceCard,
    override: OverrideCard,
    network: NetworkCard,
    usage: UsageCard,
    fileShare: FileShareCard
  }

  return (
    <div
      onMouseMove={(e) => {
        if (!resizing) return
        if (e.clientX <= 150) {
          setSiderWidthValue(narrowWidth)
        } else if (e.clientX <= 250) {
          setSiderWidthValue(250)
        } else if (e.clientX >= 400) {
          setSiderWidthValue(400)
        } else {
          setSiderWidthValue(e.clientX)
        }
      }}
      className={`w-full h-screen flex ${resizing ? 'cursor-ew-resize' : ''}`}
    >
      {siderWidthValue === narrowWidth ? (
        <div style={{ width: `${narrowWidth}px` }} className="side h-full flex flex-col">
          <div className="app-drag flex shrink-0 justify-center items-center z-40 bg-transparent h-11.25">
            <MihomoIcon className="h-8 leading-8 text-lg mx-px" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            <div className="min-h-full w-full flex flex-col gap-2">
              {order.map((key) => {
                const Component = componentMap[key]
                return <Component key={key} iconOnly={true} />
              })}
            </div>
          </div>
          <div className="px-2 pt-2 pb-4 flex shrink-0 flex-col items-center space-y-2">
            <Button
              size="sm"
              className="app-nodrag"
              isIconOnly
              color={location.pathname.includes('/settings') ? 'primary' : 'default'}
              variant={location.pathname.includes('/settings') ? 'solid' : 'light'}
              onPress={() => {
                navigate('/settings')
              }}
            >
              <IoSettings className="text-[20px]" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{ width: `${siderWidthValue}px` }}
          className="side h-full overflow-y-auto no-scrollbar"
        >
          <div className="app-drag sticky top-0 z-40 backdrop-blur bg-transparent h-12.25">
            <div className="flex justify-between p-2">
              <div className="flex ml-1">
                <MihomoIcon className="h-8 leading-8 text-lg mx-px" />
                <h3 className="text-lg font-bold leading-8">Clash Party</h3>
              </div>
              <Button
                size="sm"
                className="app-nodrag"
                isIconOnly
                color={location.pathname.includes('/settings') ? 'primary' : 'default'}
                variant={location.pathname.includes('/settings') ? 'solid' : 'light'}
                onPress={() => {
                  navigate('/settings')
                }}
              >
                <IoSettings className="text-[20px]" />
              </Button>
            </div>
          </div>
          <div style={{ overflowX: 'clip' }}>
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragEnd={onDragEnd}
              modifiers={[lockTransform]}
            >
              <div className="grid grid-cols-2 gap-2 m-2">
                <SortableContext items={order}>
                  {order.map((key) => {
                    const Component = componentMap[key]
                    return <Component key={key} />
                  })}
                </SortableContext>
              </div>
            </DndContext>
          </div>
        </div>
      )}

      <div
        onMouseDown={() => {
          setResizing(true)
        }}
        style={{
          position: 'fixed',
          zIndex: 50,
          left: `${siderWidthValue - 2}px`,
          width: '5px',
          height: '100vh',
          cursor: 'ew-resize'
        }}
        className={resizing ? 'bg-primary' : ''}
      />
      <Divider orientation="vertical" />
      <div
        style={{ width: `calc(100% - ${siderWidthValue + 1}px)` }}
        className="main grow h-full overflow-y-auto"
      >
        <Suspense fallback={<div className="h-full w-full bg-content1" />}>{page}</Suspense>
      </div>
    </div>
  )
}

export default App
