// 内置文件分发服务 — 移植自 Omega_Proxy_httpbackupserver（capability URL 模型）。
//
// 原插件基于 http-server@14.1.1 + shell 脚本，其 README 记录了四条实测陷阱：
//   1) 目录列表只能用 `-d false` 关闭（--no-d 无效）；
//   2) `--user` 参数会让进程被单个带 Authorization 头的请求打死；
//   3) 默认缓存 3600s，改了配置对方拿旧的；
//   4) npm 发布版与 GitHub master 参数不同步。
// 这里用 Node 原生 http 模块重写：无目录列表、无缓存、无鉴权中间件，
// 四条陷阱从根上不存在，也不引入任何新依赖。
//
// 安全模型与原插件一致：不做鉴权，「文件名不可猜」是唯一的访问控制。
// 文件名 = 名称-16位hex.扩展名（64 bit 熵），吊销 = 删除文件（旧链接立即 404）。
import { randomBytes } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises'
import http from 'http'
import os from 'os'
import path from 'path'
import i18next from '../../shared/i18n'
import { getAppConfig } from '../config'
import { fileShareDir, fileShareMetaPath } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
import { createLogger } from '../utils/logger'

const logger = createLogger('FileShare')

// 合法文件名：名称-16位hex.扩展名。不匹配的一律不投放、不服务。
const TOKEN_RE = /^[A-Za-z0-9._-]+-[0-9a-f]{16}\.(yaml|yml|json|conf|txt|bak)$/

export const FILE_SHARE_EXTS = ['yaml', 'yml', 'json', 'conf', 'txt', 'bak'] as const

export const DEFAULT_FILE_SHARE_PORT = 8090

// 浏览器上传经 WS 桥以 base64 传输，需要硬上限。
// ZeroOmega 备份实测可达 9.5 MB（规则列表缓存），32 MB 留足余量。
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

// ZeroOmega 在线恢复的 $http 超时是 10s（io.coffee:111），
// LAN 内没问题，但超过 4MB 就值得提醒一句「别拿它当小文件随手转发」。
const BAK_SIZE_WARN_BYTES = 4 * 1024 * 1024

// .bak 内容是 JSON（omega.types 里把 .bak 映射为 application/json 的原因）
const MIME_TYPES: Record<string, string> = {
  '.bak': 'application/json; charset=UTF-8',
  '.yaml': 'text/yaml; charset=UTF-8',
  '.yml': 'text/yaml; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.conf': 'text/plain; charset=UTF-8',
  '.txt': 'text/plain; charset=UTF-8'
}

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate'
}

// RFC1918 + loopback：LAN 外不可路由，出现在备份里不算泄露
function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === '127.0.0.1' ||
    ip === 'localhost'
  )
}

function newToken(): string {
  // 64 bit 熵（原插件用 /dev/urandom 取 8 字节），文件名不可被枚举
  return randomBytes(8).toString('hex')
}

// 名称清洗：只留 URL 安全字符（对应 issue.sh 的 tr -dc 'A-Za-z0-9._-'）
function cleanName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
}

export function isValidShareFileName(file: string): boolean {
  return TOKEN_RE.test(file)
}

// ---------------------------------------------------------------- 服务器 ---

let server: http.Server | undefined
let runningPort = 0
let runningHost = ''
let serverError: string | null = null

function sendNotFound(res: http.ServerResponse): void {
  // 目录不存在文件层面的「列表」：任何未命中 token 文件名的路径一律 404，
  // 等价于原插件强制关闭目录列表（否则 / 会把所有文件名摊给内网任何主机）。
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8', ...NO_CACHE_HEADERS })
  res.end('Not Found')
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=UTF-8', ...NO_CACHE_HEADERS })
    res.end('Method Not Allowed')
    return
  }

  // ZeroOmega 的 restoreOnline 用 cache:false，请求会带 ?_=<ts> 查询串，先剥掉
  const rawPath = (req.url || '/').split('?')[0]

  let name: string
  try {
    name = decodeURIComponent(rawPath).replace(/^\/+/, '')
  } catch {
    sendNotFound(res)
    return
  }

  // 防路径穿越 / 隐藏文件 / 目录探测
  if (
    !name ||
    name.startsWith('.') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..')
  ) {
    sendNotFound(res)
    return
  }

  const filePath = path.join(fileShareDir(), name)
  if (!isValidShareFileName(name) || !existsSync(filePath)) {
    sendNotFound(res)
    return
  }

  stat(filePath).then(
    (stats) => {
      if (!stats.isFile()) {
        sendNotFound(res)
        return
      }
      const mime = MIME_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stats.size,
        ...NO_CACHE_HEADERS
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      logger.info(`download ${req.socket.remoteAddress} GET /${name} ${stats.size}B`)
      const stream = createReadStream(filePath)
      stream.on('error', () => {
        res.destroy()
      })
      stream.pipe(res)
    },
    () => sendNotFound(res)
  )
}

export async function stopFileShareServer(): Promise<void> {
  if (!server) return
  const closing = server
  server = undefined
  serverError = null
  runningPort = 0
  runningHost = ''
  await new Promise<void>((resolve) => {
    // Node 18.2+：立即掐断 keep-alive 连接，避免 close 回调挂起
    closing.closeAllConnections?.()
    closing.close(() => resolve())
  })
}

export async function startFileShareServer(): Promise<void> {
  await stopFileShareServer()

  const { fileShare = {} } = await getAppConfig()
  if (!fileShare.enable) return

  const port = fileShare.port || DEFAULT_FILE_SHARE_PORT
  const host = fileShare.host || '0.0.0.0'

  await mkdir(fileShareDir(), { recursive: true })

  const s = http.createServer(handleRequest)
  s.on('error', (err) => {
    serverError = String((err as Error).message || err)
    logger.error(`file share server error: ${serverError}`)
    if (server === s) {
      server = undefined
      runningPort = 0
      runningHost = ''
    }
  })

  try {
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject)
      s.listen(port, host, () => resolve())
    })
  } catch (e) {
    serverError = String((e as Error).message || e)
    logger.error(`file share server failed to listen on ${host}:${port}: ${serverError}`)
    return
  }

  server = s
  runningPort = port
  runningHost = host
  serverError = null
  logger.info(`file share server listening on http://${host}:${port}/`)
}

export async function restartFileShareServer(): Promise<void> {
  await startFileShareServer()
}

export async function getFileShareServerState(): Promise<IFileShareServerState> {
  const { fileShare = {} } = await getAppConfig()
  return {
    enabled: fileShare.enable === true,
    running: server !== undefined,
    port: runningPort || fileShare.port || DEFAULT_FILE_SHARE_PORT,
    host: runningHost || fileShare.host || '0.0.0.0',
    error: serverError
  }
}

// ------------------------------------------------------------- 校验逻辑 ---

// 完整移植 issue.sh 的 validate_bak + 凭证关键词扫描。
// 为什么必须在投放【之前】查：ZeroOmega 的 restoreOnline 拿到文本就交给 reset()，
// 而 reset() 内部是 _storage.remove() 后再 set —— 覆盖式导入。
// 一个解析不了的 .bak 会让同事点完「恢复」之后配置被清空，而不是"什么都没发生"。
export function validateShareContent(fileName: string, content: Buffer): IFileShareValidation {
  const issues: IFileShareIssue[] = []
  const t = i18next.t
  const ext = path.extname(fileName).slice(1).toLowerCase()
  const text = content.toString('utf8')

  if (ext === 'bak') {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      issues.push({
        level: 'fatal',
        message: t('fileShare.validation.notJson', { error: String((e as Error).message || e) })
      })
      return { ok: false, issues }
    }

    const profiles = Object.keys(parsed).filter((k) => k.startsWith('+'))
    const cached = profiles.filter((k) => k.startsWith('+__ruleListOf_'))
    const real = profiles.filter((k) => !k.startsWith('+__ruleListOf_'))

    if (parsed['schemaVersion'] === undefined) {
      issues.push({ level: 'warn', message: t('fileShare.validation.missingSchemaVersion') })
    }

    // __ruleListOf_* 是「规则列表型 profile」的缓存副本，可能占掉整个文件的绝大部分体积。
    // 这份副本要保留：源在 raw.githubusercontent.com，国内直连拉不动。
    for (const key of cached) {
      const value = parsed[key] as { ruleList?: unknown; pacScript?: { length: number } }
      const bytes = Buffer.byteLength(JSON.stringify(value))
      issues.push({
        level: 'info',
        message: t('fileShare.validation.cachedRuleList', {
          profile: key.replace(/^\+__ruleListOf_/, ''),
          size: (bytes / 1048576).toFixed(1)
        })
      })
    }

    for (const key of real) {
      const profile = parsed[key] as {
        name?: string
        fallbackProxy?: {
          host?: string
          port?: number
          scheme?: string
          authUser?: string
          authPass?: string
        }
        proxy?: {
          host?: string
          port?: number
          scheme?: string
          authUser?: string
          authPass?: string
        }
        bypassList?: { pattern: string }[]
      }
      const proxy = profile.fallbackProxy || profile.proxy || {}
      const label = profile.name || key.slice(1)
      if (proxy.host) {
        if (!isPrivateIp(proxy.host)) {
          issues.push({
            level: 'fatal',
            message: t('fileShare.validation.routableProxy', {
              profile: label,
              host: proxy.host,
              port: proxy.port ?? ''
            })
          })
        } else {
          issues.push({
            level: 'info',
            message: t('fileShare.validation.lanProxy', {
              profile: label,
              host: proxy.host,
              port: proxy.port ?? ''
            })
          })
        }
        if (proxy.authUser || proxy.authPass) {
          issues.push({
            level: 'fatal',
            message: t('fileShare.validation.proxyAuth', { profile: label })
          })
        }
      }
      for (const bypass of profile.bypassList || []) {
        const m = /^[*.](.+)$/.exec(bypass.pattern || '')
        if (m) {
          issues.push({
            level: 'warn',
            message: t('fileShare.validation.bypassDomain', { domain: bypass.pattern })
          })
        }
      }
    }

    if (!real.length) {
      issues.push({ level: 'fatal', message: t('fileShare.validation.emptyBackup') })
    }

    // 备份里可能藏着内网拓扑：全文扫一遍可路由 IP
    const hosts = [...new Set(text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [])]
    const routable = hosts.filter((h) => !isPrivateIp(h) && h !== '127.0.0.1')
    if (routable.length) {
      issues.push({
        level: 'fatal',
        message: t('fileShare.validation.routableIp', { ips: routable.join(', ') })
      })
    }

    if (parsed['-startupProfileName']) {
      issues.push({
        level: 'info',
        message: t('fileShare.validation.startupProfile', {
          name: String(parsed['-startupProfileName'])
        })
      })
    } else {
      issues.push({ level: 'warn', message: t('fileShare.validation.noStartupProfile') })
    }

    if (content.length > BAK_SIZE_WARN_BYTES) {
      issues.push({
        level: 'warn',
        message: t('fileShare.validation.bigFile', { size: (content.length / 1048576).toFixed(1) })
      })
    }
  } else {
    // 非 .bak：只做内容级提示——看起来像 mihomo 配置才给"含凭证"的警告，不瞎猜
    const head = text.slice(0, 4096)
    if (/password|secret|uuid|token|server-key/i.test(head)) {
      issues.push({ level: 'warn', message: t('fileShare.validation.credentialKeywords') })
    }
  }

  const ok = !issues.some((issue) => issue.level === 'fatal')
  return { ok, issues }
}

// ------------------------------------------------------------ 文件管理 ---

// 元数据(别名/分组)与分发文件分离存储: 文件名即 URL 凭证不可改,
// 重命名/归组只动元数据,已分发的链接永不失效。
// 结构: { files: { [原始文件名]: { alias?, group? } } }
interface FileShareMetaEntry {
  alias?: string
  group?: string
}
interface FileShareMeta {
  files: Record<string, FileShareMetaEntry>
}

let metaCache: FileShareMeta | null = null

async function readMeta(): Promise<FileShareMeta> {
  if (metaCache) return metaCache
  let meta: FileShareMeta = { files: {} }
  if (existsSync(fileShareMetaPath())) {
    try {
      const parsed = JSON.parse(await readFile(fileShareMetaPath(), 'utf-8'))
      if (parsed && typeof parsed === 'object' && typeof parsed.files === 'object') {
        meta = parsed as FileShareMeta
      }
    } catch (e) {
      logger.warn(`file share meta corrupted, reset: ${String(e)}`)
    }
  }
  metaCache = meta
  return meta
}

async function writeMeta(meta: FileShareMeta): Promise<void> {
  // 落盘前剔除指向不存在文件的条目,吊销后残留不累积
  const existing = new Set(
    (await readdir(fileShareDir()).catch(() => [] as string[])).filter(isValidShareFileName)
  )
  for (const key of Object.keys(meta.files)) {
    if (!existing.has(key)) delete meta.files[key]
  }
  metaCache = meta
  await atomicWriteFile(fileShareMetaPath(), JSON.stringify(meta, null, 2), { encoding: 'utf8' })
}

// 编辑文件元数据: 别名(显示名)与分组。URL/底层文件名不变。
export async function setFileShareFileMeta(
  file: string,
  patch: IFileShareFileMetaPatch
): Promise<void> {
  if (!isValidShareFileName(file)) {
    throw new Error(`invalid share file name: ${file}`)
  }
  const meta = await readMeta()
  const entry = meta.files[file] || {}
  if (patch.alias !== undefined) {
    const alias = patch.alias.trim()
    if (alias) entry.alias = alias
    else delete entry.alias
  }
  if (patch.group !== undefined) {
    const group = patch.group.trim()
    if (group) entry.group = group
    else delete entry.group
  }
  if (entry.alias === undefined && entry.group === undefined) delete meta.files[file]
  else meta.files[file] = entry
  await writeMeta(meta)
}

// 分组重命名: 该组下所有文件的 group 一并改为新名(空分组无痕,无条目即无操作)
export async function renameFileShareGroup(from: string, to: string): Promise<void> {
  const src = from.trim()
  const dest = to.trim()
  if (!src || !dest || src === dest) return
  const meta = await readMeta()
  let touched = 0
  for (const entry of Object.values(meta.files)) {
    if (entry.group === src) {
      entry.group = dest
      touched++
    }
  }
  if (touched > 0) await writeMeta(meta)
}

export async function listFileShareFiles(): Promise<IFileShareFileInfo[]> {
  await mkdir(fileShareDir(), { recursive: true })
  const meta = await readMeta()
  const entries = await readdir(fileShareDir())
  const infos: IFileShareFileInfo[] = []
  for (const entry of entries) {
    if (!isValidShareFileName(entry)) continue
    const filePath = path.join(fileShareDir(), entry)
    const stats = await stat(filePath).catch(() => null)
    if (!stats?.isFile()) continue
    const m = meta.files[entry]
    infos.push({
      file: entry,
      size: stats.size,
      mtime: stats.mtimeMs,
      alias: m?.alias,
      group: m?.group
    })
  }
  infos.sort((a, b) => b.mtime - a.mtime)
  return infos
}

export async function addFileShareFile(
  fileName: string,
  contentBase64: string
): Promise<IFileShareAddResult> {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (!(FILE_SHARE_EXTS as readonly string[]).includes(ext)) {
    throw new Error(
      i18next.t('fileShare.error.unsupportedExt', { exts: FILE_SHARE_EXTS.join(', ') })
    )
  }

  const content = Buffer.from(contentBase64, 'base64')
  if (content.length === 0) {
    throw new Error(i18next.t('fileShare.error.emptyFile'))
  }
  if (content.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      i18next.t('fileShare.error.tooLarge', { size: (MAX_UPLOAD_BYTES / 1048576).toFixed(0) })
    )
  }

  const validation = validateShareContent(fileName, content)
  if (!validation.ok) {
    // 致命问题（可路由 IP / 代理凭据 / 坏 JSON / 空备份）：不投放
    logger.warn(
      `rejected ${fileName}: ${validation.issues
        .filter((i) => i.level === 'fatal')
        .map((i) => i.message)
        .join('; ')}`
    )
    return { added: false, file: null, validation }
  }

  const base = cleanName(path.basename(fileName, path.extname(fileName)))
  const name = base || 'config'
  const dest = `${name}-${newToken()}.${ext}`

  await mkdir(fileShareDir(), { recursive: true })
  await atomicWriteFile(path.join(fileShareDir(), dest), content)
  logger.info(`issued ${dest} (${content.length}B)`)
  return { added: true, file: dest, validation }
}

export async function revokeFileShareFile(file: string): Promise<void> {
  if (!isValidShareFileName(file)) {
    throw new Error(`invalid share file name: ${file}`)
  }
  await rm(path.join(fileShareDir(), file), { force: true })
  logger.info(`revoked ${file}`)
}

export async function getFileShareUrls(file: string): Promise<string[]> {
  if (!isValidShareFileName(file)) {
    throw new Error(`invalid share file name: ${file}`)
  }
  const { fileShare = {} } = await getAppConfig()
  const port = runningPort || fileShare.port || DEFAULT_FILE_SHARE_PORT
  const host = runningHost || fileShare.host || '0.0.0.0'

  const urls = new Set<string>()
  if (host !== '0.0.0.0' && host !== '::') {
    urls.add(`http://${host}:${port}/${file}`)
  } else {
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos || []) {
        if (info.family === 'IPv4' && !info.internal) {
          urls.add(`http://${info.address}:${port}/${file}`)
        }
      }
    }
    if (urls.size === 0) urls.add(`http://127.0.0.1:${port}/${file}`)
  }
  return [...urls]
}
