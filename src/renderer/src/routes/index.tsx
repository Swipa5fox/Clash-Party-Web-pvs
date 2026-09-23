import { Navigate } from 'react-router-dom'
import { lazy } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { getSiderCardRoute } from '@renderer/utils/sider'

const NetworkPage = lazy(() => import('@renderer/pages/network'))
const Override = lazy(() => import('@renderer/pages/override'))
const Proxies = lazy(() => import('@renderer/pages/proxies'))
const Rules = lazy(() => import('@renderer/pages/rules'))
const Settings = lazy(() => import('@renderer/pages/settings'))
const Profiles = lazy(() => import('@renderer/pages/profiles'))
const Logs = lazy(() => import('@renderer/pages/logs'))
const Connections = lazy(() => import('@renderer/pages/connections'))
const Mihomo = lazy(() => import('@renderer/pages/mihomo'))
const Resources = lazy(() => import('@renderer/pages/resources'))
const DNS = lazy(() => import('@renderer/pages/dns'))
const Sniffer = lazy(() => import('@renderer/pages/sniffer'))
const Traffic = lazy(() => import('@renderer/pages/traffic'))
const FileShare = lazy(() => import('@renderer/pages/file-share'))

const HomeRedirect: React.FC = () => {
  const { appConfig } = useAppConfig()

  if (!appConfig) return null
  const dest = appConfig.rememberSelectedSiderCard ? appConfig.lastSelectedSiderCard : 'proxy'
  return <Navigate to={getSiderCardRoute(dest)} replace />
}

const routes = [
  {
    path: '/network',
    element: <NetworkPage />
  },
  {
    path: '/mihomo',
    element: <Mihomo />
  },
  {
    path: '/proxies',
    element: <Proxies />
  },
  {
    path: '/rules',
    element: <Rules />
  },
  {
    path: '/resources',
    element: <Resources />
  },
  {
    path: '/dns',
    element: <DNS />
  },
  {
    path: '/sniffer',
    element: <Sniffer />
  },
  {
    path: '/logs',
    element: <Logs />
  },
  {
    path: '/connections',
    element: <Connections />
  },
  {
    path: '/override',
    element: <Override />
  },
  {
    path: '/profiles',
    element: <Profiles />
  },
  {
    path: '/settings',
    element: <Settings />
  },
  {
    path: '/traffic',
    element: <Traffic />
  },
  {
    path: '/file-share',
    element: <FileShare />
  },
  {
    path: '/',
    element: <HomeRedirect />
  }
]

export default routes
