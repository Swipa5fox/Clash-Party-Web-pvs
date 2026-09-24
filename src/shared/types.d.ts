type OutboundMode = 'rule' | 'global' | 'direct'
type LogLevel = 'info' | 'debug' | 'warning' | 'error' | 'silent'
type SysProxyMode = 'auto' | 'manual'
type CardStatus = 'col-span-2' | 'col-span-1' | 'hidden'
type SiderCardKey =
  | 'profile'
  | 'proxy'
  | 'rule'
  | 'resource'
  | 'override'
  | 'connection'
  | 'mihomo'
  | 'dns'
  | 'sniff'
  | 'log'
  | 'network'
  | 'usage'
  | 'fileShare'
type NetworkInfoCardKey = 'ip' | 'topology' | 'latency'
type FileShareIssueLevel = 'info' | 'warn' | 'fatal'
interface IFileShareIssue {
  level: FileShareIssueLevel
  message: string
}
interface IFileShareValidation {
  ok: boolean
  issues: IFileShareIssue[]
}
interface IFileShareFileInfo {
  file: string
  size: number
  mtime: number
  // 显示别名(重命名不影响分发 URL,底层文件名即凭证不变)
  alias?: string
  // 所属分组名(未归组为 undefined,渲染层归入默认分组)
  group?: string
}
// 文件分发元数据编辑: alias 改显示名, group 改归属分组(空串=移出分组)
interface IFileShareFileMetaPatch {
  alias?: string
  group?: string
}
interface IFileShareServerState {
  enabled: boolean
  running: boolean
  port: number
  host: string
  error: string | null
}
interface IFileShareAddResult {
  added: boolean
  file: string | null
  validation: IFileShareValidation
}
type AppTheme = 'system' | 'light' | 'dark'
type MihomoGroupType = 'Selector' | 'URLTest' | 'Fallback' | 'LoadBalance' | 'Relay'
type Priority =
  | 'PRIORITY_LOW'
  | 'PRIORITY_BELOW_NORMAL'
  | 'PRIORITY_NORMAL'
  | 'PRIORITY_ABOVE_NORMAL'
  | 'PRIORITY_HIGH'
  | 'PRIORITY_HIGHEST'
type MihomoProxyType =
  | 'Direct'
  | 'Reject'
  | 'RejectDrop'
  | 'Pass'
  | 'Dns'
  | 'Compatible'
  | 'Socks5'
  | 'Http'
  | 'Ssh'
  | 'Shadowsocks'
  | 'ShadowsocksR'
  | 'Snell'
  | 'Vmess'
  | 'Vless'
  | 'Trojan'
  | 'Hysteria'
  | 'Hysteria2'
  | 'Tuic'
  | 'WireGuard'
  | 'Mieru'
  | 'AnyTLS'
  | 'Sudoku'
  | 'Masque'
  | 'TrustTunnel'
type TunStack = 'gvisor' | 'mixed' | 'system'
type FindProcessMode = 'off' | 'strict' | 'always'
type DnsMode = 'normal' | 'fake-ip' | 'redir-host' | 'hosts'
type FilterMode = 'blacklist' | 'whitelist' | 'rule'
type NetworkInterfaceInfo = os.NetworkInterfaceInfo

interface IAppVersion {
  version: string
  changelog: string
}

interface IMihomoVersion {
  version: string
  meta: boolean
}

interface IMihomoTrafficInfo {
  up: number
  down: number
}

interface IMihomoMemoryInfo {
  inuse: number
  oslimit: number
}

interface IMihomoLogInfo {
  type: LogLevel
  payload: string
  time?: string
}

interface IMihomoRulesInfo {
  rules: IMihomoRulesDetail[]
}

interface IMihomoRulesDetail {
  type: string
  payload: string
  proxy: string
  size: number
  index: number
  extra?: {
    disabled: boolean
    hitCount: number
    hitAt: string
    missCount: number
    missAt: string
  }
}

interface IMihomoConnectionsInfo {
  downloadTotal: number
  uploadTotal: number
  connections?: IMihomoConnectionDetail[]
  memory: number
}

interface IMihomoConnectionDetail {
  id: string
  isActive: boolean
  metadata: {
    network: 'tcp' | 'udp'
    type: string
    sourceIP: string
    sourceGeoIP: string[]
    sourceIPASN: string
    destinationIP: string
    destinationGeoIP: string[]
    destinationIPASN: string
    sourcePort: string
    destinationPort: string
    inboundIP: string
    inboundPort: string
    inboundName: string
    inboundUser: string
    host: string
    dnsMode: string
    uid: number
    process: string
    processPath: string
    specialProxy: string
    specialRules: string
    remoteDestination: string
    dscp: number
    sniffHost: string
  }
  uploadSpeed?: number
  downloadSpeed?: number
  upload: number
  download: number
  start: string
  chains: string[]
  providerChains: string[]
  rule: string
  rulePayload: string
}

interface IMihomoHistory {
  time: string
  delay: number
}

type IMihomoGroupDelay = Record<string, number>

interface IMihomoDelay {
  delay?: number
  message?: string
}

interface IMihomoProxy {
  alive: boolean
  extra: Record<string, { alive: boolean; history: IMihomoHistory[] }>
  history: IMihomoHistory[]
  id: string
  name: string
  tfo: boolean
  type: MihomoProxyType
  udp: boolean
  uot: boolean
  xudp: boolean
  mptcp: boolean
  smux: boolean
  interface?: string
  'routing-mark'?: number
  'provider-name'?: string
  'dialer-proxy'?: string
}

interface IMihomoGroup {
  alive: boolean
  all: string[]
  extra: Record<string, { alive: boolean; history: IMihomoHistory[] }>
  testUrl?: string
  expectedStatus?: string
  fixed?: string
  hidden: boolean
  history: IMihomoHistory[]
  icon: string
  name: string
  now: string
  tfo: boolean
  type: MihomoGroupType
  udp: boolean
  xudp: boolean
}

interface IMihomoProxies {
  proxies: Record<string, IMihomoProxy | IMihomoGroup>
}

interface IMihomoMixedGroup extends Omit<IMihomoGroup, 'all'> {
  // 嵌套子组同样被递归解析(all 为对象数组),所以成员类型递归引用自身。
  // Omit 掉父类的 all(string[])避免递归类型与 extends 的兼容性冲突。
  all: (IMihomoProxy | IMihomoMixedGroup)[]
}

interface IMihomoRuleProviders {
  providers: Record<string, IMihomoRuleProvider>
}

interface IMihomoRuleProvider {
  behavior: string
  format: string
  name: string
  ruleCount: number
  type: string
  updatedAt: string
  vehicleType: string
  payload?: string[]
}

interface IMihomoProxyProviders {
  providers: Record<string, IMihomoProxyProvider>
}

interface ISubscriptionUserInfoUpper {
  Upload: number
  Download: number
  Total: number
  Expire: number
}

interface IMihomoProxyProvider {
  name: string
  type: string
  proxies?: IMihomoProxy[]
  subscriptionInfo?: ISubscriptionUserInfoUpper
  expectedStatus: string
  testUrl?: string
  updatedAt?: string
  vehicleType: string
}

interface ISysProxyConfig {
  enable: boolean
  host?: string
  mode?: SysProxyMode
  bypass?: string[]
  pacScript?: string
}

interface INetworkLatencyTarget {
  name: string
  url: string
}

interface IAppConfig {
  core: 'mihomo' | 'mihomo-alpha' | 'mihomo-smart' | 'mihomo-specific'
  specificVersion?: string
  enableSmartCore: boolean
  enableSmartOverride: boolean
  smartCoreUseLightGBM: boolean
  smartCoreCollectData: boolean
  smartCoreStrategy: 'sticky-sessions' | 'round-robin'
  smartCollectorSize?: number
  proxyDisplayMode: 'simple' | 'full'
  proxyDisplayOrder: 'default' | 'delay' | 'name'
  profileDisplayDate?: 'expire' | 'update'
  envType?: ('bash' | 'cmd' | 'powershell' | 'fish' | 'nushell')[]
  proxyCols: 'auto' | '1' | '2' | '3' | '4'
  hideUnavailableProxies?: boolean
  connectionDirection: 'asc' | 'desc'
  connectionOrderBy: 'time' | 'upload' | 'download' | 'uploadSpeed' | 'downloadSpeed'
  connectionViewMode?: 'list' | 'table'
  connectionTableColumns?: string[]
  connectionTableColumnWidths?: Record<string, number>
  connectionTableSortColumn?: string
  connectionTableSortDirection?: 'asc' | 'desc'
  displayIcon?: boolean
  connectionCardStatus?: CardStatus
  dnsCardStatus?: CardStatus
  logCardStatus?: CardStatus
  hideConnectionCardWave?: boolean
  pauseSSID?: string[]
  disableDnsOnPauseSSID?: boolean
  controlDnsBeforePause?: boolean
  mihomoCoreCardStatus?: CardStatus
  overrideCardStatus?: CardStatus
  profileCardStatus?: CardStatus
  proxyCardStatus?: CardStatus
  networkCardStatus?: CardStatus
  resourceCardStatus?: CardStatus
  ruleCardStatus?: CardStatus
  sniffCardStatus?: CardStatus
  usageCardStatus?: CardStatus
  fileShareCardStatus?: CardStatus
  fileShare?: {
    enable?: boolean
    port?: number
    host?: string
  }
  githubToken?: string
  gistAgeEncrypt?: boolean
  gistAgeRecipient?: string
  gistAgeSecretKey?: string
  pluginUseProxy?: boolean // 插件网关请求经由本地混合端口代理（安全保证降级，默认关闭）
  mihomoCpuPriority?: Priority
  coreStartupMode?: 'log' | 'post-up'
  diffWorkDir?: boolean
  autoSetDNS?: boolean
  originDNS?: string
  enableTrafficLogger?: boolean
  siderOrder: string[]
  lastSelectedSiderCard?: SiderCardKey
  rememberSelectedSiderCard?: boolean
  lockSiderCards?: boolean
  siderWidth: number
  appTheme: AppTheme
  customTheme?: string
  autoCheckUpdate: boolean
  autoUpdateProfileOnStart: boolean
  silentUpdate: boolean
  githubProxy?: string
  autoCloseConnection: boolean
  sysProxy: ISysProxyConfig
  maxLogDays: number
  maxLogFileSize: number
  disableAppLog?: boolean
  disableCoreLog?: boolean
  userAgent?: string
  delayTestConcurrency?: number
  delayTestUrl?: string
  delayTestTimeout?: number
  networkLatencyTargets?: INetworkLatencyTarget[]
  networkIPProvider?: 'ip.sb' | 'ipwho.is' | 'ipapi.is'
  networkInfoCardOrder?: NetworkInfoCardKey[]
  subscriptionTimeout?: number
  encryptedPassword?: number[]
  controlDns?: boolean
  controlSniff?: boolean
  disableAnimations?: boolean
  webdavUrl?: string
  webdavDir?: string
  webdavUsername?: string
  webdavPassword?: string
  webdavMaxBackups?: number
  webdavBackupCron?: string
  webdavIgnoreCert?: boolean
  useNameserverPolicy: boolean
  nameserverPolicy: { [key: string]: string | string[] }
  // 语言集合与 general-config 语言下拉及 locales 资源保持一致
  language?: 'zh-CN' | 'en-US'
  showMixedPort?: number
  enableMixedPort?: boolean
  showSocksPort?: number
  enableSocksPort?: boolean
  showHttpPort?: number
  enableHttpPort?: boolean
  showRedirPort?: number
  enableRedirPort?: boolean
  showTproxyPort?: number
  enableTproxyPort?: boolean
  testProfileOnStart?: boolean
  useHotReloadProfile?: boolean
  hotReloadProfileAutoCloseConnection?: boolean
}

interface IMihomoTunConfig {
  enable?: boolean
  stack?: TunStack
  'auto-route'?: boolean
  'auto-redirect'?: boolean
  'auto-detect-interface'?: boolean
  'dns-hijack'?: string[]
  device?: string
  mtu?: number
  'strict-route'?: boolean
  gso?: boolean
  'gso-max-size'?: number
  'udp-timeout'?: number
  'iproute2-table-index'?: number
  'iproute2-rule-index'?: number
  'endpoint-independent-nat'?: boolean
  'route-address-set'?: string[]
  'route-exclude-address-set'?: string[]
  'route-address'?: string[]
  'route-exclude-address'?: string[]
  'include-interface'?: string[]
  'exclude-interface'?: string[]
  'include-uid'?: number[]
  'include-uid-range'?: string[]
  'exclude-uid'?: number[]
  'exclude-uid-range'?: string[]
  'include-android-user'?: string[]
  'include-package'?: string[]
  'exclude-package'?: string[]
}
interface IMihomoDNSConfig {
  enable?: boolean
  listen?: string
  ipv6?: boolean
  'ipv6-timeout'?: number
  'prefer-h3'?: boolean
  'enhanced-mode'?: DnsMode
  'fake-ip-range'?: string
  'fake-ip-filter'?: string[]
  'fake-ip-filter-mode'?: FilterMode
  'use-hosts'?: boolean
  'use-system-hosts'?: boolean
  'respect-rules'?: boolean
  'default-nameserver'?: string[]
  nameserver?: string[]
  fallback?: string[]
  'fallback-filter'?: { [key: string]: boolean | string | string[] }
  'proxy-server-nameserver'?: string[]
  'direct-nameserver'?: string[]
  'direct-nameserver-follow-policy'?: boolean
  'nameserver-policy'?: { [key: string]: string | string[] }
  'cache-algorithm'?: string
}

interface IMihomoSnifferConfig {
  enable?: boolean
  'parse-pure-ip'?: boolean
  'override-destination'?: boolean
  'force-dns-mapping'?: boolean
  'force-domain'?: string[]
  'skip-domain'?: string[]
  'skip-dst-address'?: string[]
  'skip-src-address'?: string[]
  sniff?: {
    HTTP?: {
      ports: (number | string)[]
      'override-destination'?: boolean
    }
    TLS?: {
      ports: (number | string)[]
    }
    QUIC?: {
      ports: (number | string)[]
    }
  }
}

interface IMihomoProfileConfig {
  'store-selected'?: boolean
  'store-fake-ip'?: boolean
}

interface IMihomoConfig {
  'external-controller-pipe': string
  'external-controller-unix': string
  'external-controller': string
  'external-ui': string
  'external-ui-url': string
  'external-controller-cors'?: {
    'allow-origins'?: string[]
    'allow-private-network'?: boolean
  }
  secret?: string
  ipv6: boolean
  mode: OutboundMode
  'mixed-port': number
  'allow-lan': boolean
  'unified-delay': boolean
  'tcp-concurrent': boolean
  'log-level': LogLevel
  'find-process-mode': FindProcessMode
  'socks-port'?: number
  'redir-port'?: number
  'tproxy-port'?: number
  'skip-auth-prefixes'?: string[]
  'bind-address'?: string
  'lan-allowed-ips'?: string[]
  'lan-disallowed-ips'?: string[]
  authentication: string[]
  port?: number
  proxies?: []
  'proxy-groups'?: []
  listeners?: IMihomoListenerConfig[]
  rules?: []
  hosts?: { [key: string]: string | string[] }
  'geodata-mode'?: boolean
  'geo-auto-update'?: boolean
  'geo-update-interval'?: number
  'geox-url'?: {
    geoip?: string
    geosite?: string
    mmdb?: string
    asn?: string
  }
  tun: IMihomoTunConfig
  dns: IMihomoDNSConfig
  sniffer: IMihomoSnifferConfig
  profile: IMihomoProfileConfig
}

interface IProfileConfig {
  current?: string
  items: IProfileItem[]
}

// 自定义线路组: 入口组(自动/故障/手动/全局子组) + 专属端口
interface ICustomLineGroup {
  id: string
  name: string
  port: number
  proxies: string[]
  testUrl?: string
  interval?: number
  auto: boolean
  fallback: boolean
  manual: boolean
  // 全局子组: select 类型直接包含该组全部线路, 可手选任意线路
  global?: boolean
  // 停用开关: false 时不注入该组的代理组与专属端口 listener(配置保留)
  enabled?: boolean
}

interface ICustomLineGroupsConfig {
  items: ICustomLineGroup[]
}

// 端口占用探测结果
interface IPortCheckResult {
  occupied: boolean
  // local = 内核所在命名空间(内核自身端口/本机服务)占用; remote = 探测地址上的其它服务
  source?: 'local' | 'remote'
  detail?: string
}

interface IMihomoListenerConfig {
  name: string
  type: string
  port: number
  listen?: string
  proxy?: string
  [key: string]: unknown
}

interface IOverrideItem {
  id: string
  type: 'remote' | 'local'
  ext: 'js' | 'yaml'
  name: string
  updated: number
  global?: boolean
  url?: string
  file?: string
}

interface IOverrideConfig {
  items: IOverrideItem[]
}

interface ISubscriptionUserInfo {
  upload: number
  download: number
  total: number
  expire: number
}

interface IProfileItem {
  id: string
  type: 'remote' | 'local' | 'plugin'
  name: string
  url?: string // remote
  file?: string // local
  interval?: number | string
  home?: string
  updated?: number
  override?: string[]
  useProxy?: boolean
  extra?: ISubscriptionUserInfo
  allowFixedInterval?: boolean
  autoUpdate?: boolean
  authToken?: string
  userAgent?: string
  ageSecretKey?: string
  updateTimeout?: number
  pluginId?: string
}

interface IPluginProvider {
  name: string
  icon?: string
  site?: string
}

// .cpx v2 — public, unencrypted descriptor. Contains NO secrets.
interface IPluginDescriptor {
  magic: 'CPXF'
  v: 2
  spec: 'cpx-plugin/2'
  loginUrl: string // OAuth authorize endpoint, https, no query/fragment
  provider: IPluginProvider
}

// Subset returned by previewPlugin for the install-confirm page (no records, no network)
interface IPluginDescriptorPreview {
  name: string
  icon?: string
  site?: string
  loginUrl: string // full url; UI shows the host
  spec: string
}

interface IGatewayEndpoints {
  enroll: string
  challenge: string
  config: string
  revoke: string
}

// /.well-known/cpx-gateway discovery response
interface IGatewayWellKnown {
  spec: 'cpx-plugin/2'
  gateway: string // https origin, no path/query/fragment
  endpoints: IGatewayEndpoints
}

type IPluginStatus = 'needs-login' | 'active' | 'needs-reauth'

interface IPluginItem {
  id: string
  name: string
  icon?: string
  site?: string
  loginUrl: string // public metadata; required to re-open the browser after restart
  spec: string
  profileId?: string // absent while 'needs-login'; present once 'active'/'needs-reauth'
  status: IPluginStatus
  interval?: number
  autoUpdate?: boolean
  useProxy?: boolean // 插件请求经由代理开关（可选，覆盖全局配置）
  created: number
  updated: number
  lastUpdateErrorType?: 'auth' | 'transient'
  lastUpdateErrorAt?: number
  nextRetryAt?: number
  failureCount?: number
}

interface IPluginConfig {
  items: IPluginItem[]
}

// Vault payload — plaintext JSON on disk (LAN direct-access build, no device key).
interface IPluginVault {
  deviceId: string // UUIDv4
  gateway: {
    gateway: string // discovered http(s) origin (cached for silent updates)
    endpoints: IGatewayEndpoints
  }
}
