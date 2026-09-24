#!/usr/bin/env node
// lines.mjs — mihomo party 网关「国家双口线路」管理器
// 子命令: list | add | remove | switch | verify | trace
// add:    node lines.mjs add <PREFIX> <base端口> '<节点正则>'
// 例:     node lines.mjs add KR 9998 '韩国|Korea|Seoul|首尔|KR'
// 门(gate): 目标端口需已在 docker-compose.override.yml 映射;verify 会检测并提示。
// 关键不变量: 覆写源码烘焙字面量(禁止 process.env — 重载时在 app 进程执行)。
import net from 'node:net'
import http from 'node:http'
import tlsLib from 'node:tls'
import { readFileSync } from 'node:fs'

// 配置加载: 环境变量 > 脚本同目录 lines.config.json > 报错
// lines.config.json 示例(不分享): {"host":"192.168.x.x","token":"xxxx"}
function loadCfg() {
  let host = process.env.LINES_HOST,
    token = process.env.LINES_TOKEN
  if (!host || !token) {
    try {
      const c = JSON.parse(readFileSync(new URL('./lines.config.json', import.meta.url), 'utf8'))
      host = host || c.host
      token = token || c.token
    } catch {
      /* 忽略: 配置缺失或已销毁 */
    }
  }
  if (!host || !token) {
    console.error(
      '[lines][FAIL] 缺配置: 设 LINES_HOST/LINES_TOKEN 环境变量, 或在脚本同目录放 lines.config.json: {"host":"<ip>","token":"<web-token>"}'
    )
    process.exit(1)
  }
  return { host, token }
}
const { host: HOST, token: TOKEN } = loadCfg()
const WS_URL = `ws://${HOST}:3999/ws?token=${TOKEN}`
const API = `http://${HOST}:8080`
const [cmd, ...a] = process.argv.slice(2)
const log = console.log
const die = (m) => {
  console.error('[lines][FAIL] ' + m)
  process.exit(1)
}

const rest = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`)
  return r.status === 204 ? null : r.json()
}

async function bridge() {
  const ws = new WebSocket(WS_URL)
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.type === 'result' && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error))
    }
  })
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('WS 桥 8s 未响应')), 8000)
    const ok = () => {
      clearTimeout(t)
      res()
    }
    ws.addEventListener('open', ok)
    ws.addEventListener('message', (e) => {
      JSON.parse(e.data).type === 'hello' && ok()
    })
    ws.addEventListener('error', () => {
      clearTimeout(t)
      rej(new Error('WS 连接失败(token/3999?)'))
    })
  })
  const call = (ch, ...args) =>
    new Promise((resolve, reject) => {
      const id = 'c' + Math.random().toString(36).slice(2)
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ type: 'invoke', id, channel: ch, args }))
    })
  return { ws, call }
}

function overrideSrc(prefix, base, reStr, forceDomains, flat = false) {
  const glob = base + 1,
    q = JSON.stringify
  const POOL = `${prefix}·通用[${base}]`,
    GLOB = `${prefix}·全局[${glob}]`
  const AUTO = `${prefix}·自动`,
    FB = `${prefix}·故障`,
    MAN = `${prefix}·手动`
  const mix = `${prefix.toLowerCase()}-mix`,
    glb = `${prefix.toLowerCase()}-glb`
  const forced = (forceDomains || []).map(
    (d) => `AND,((IN-NAME,${mix}),(DOMAIN-SUFFIX,${d})),${POOL}`
  )
  // 生成源拼装: 只有嵌套模式生成子组;平铺模式 sub 为空数组,入口组直接挂节点。
  const subDecl = flat
    ? 'const sub = []'
    : `const sub = ordered.length ? [
    { name: AUTO, type: 'url-test', proxies: ordered, url: TEST_URL, interval: 300, tolerance: 50, hidden: true },
    { name: FB, type: 'fallback', proxies: ordered, url: TEST_URL, interval: 300, hidden: true },
    { name: MAN, type: 'select', proxies: ordered.concat(['DIRECT']), hidden: true },
  ] : []`
  const membersDecl = flat
    ? "const members = ordered.length ? ordered : ['DIRECT']"
    : "const members = ordered.length ? [AUTO, FB, MAN] : ['DIRECT']"
  return `function main(config) {
  const re = new RegExp(${q(reStr)}, 'i')
  const nodes = (config['proxies'] || []).filter(p => re.test(p.name)).map(p => p.name)
  const num = n => parseInt((/(\\d{1,2})\\s*$/.exec(n) || [0, 99])[1], 10)
  const ordered = nodes.slice().sort((x, y) => num(x) - num(y))
  const POOL = ${q(POOL)}, GLOB = ${q(GLOB)}, AUTO = ${q(AUTO)}, FB = ${q(FB)}, MAN = ${q(MAN)}
  const TEST_URL = 'http://www.gstatic.com/generate_204'
  // 入口组成员: 嵌套模式(默认)=三个 hidden 子组,主进程 mihomoGroups 从顶层过滤,
  // 由 SubgroupItem 嵌套卡片渲染;平铺模式(--flat)=节点本身,兼容不认识嵌套的旧前端。
  ${subDecl}
  ${membersDecl}
  const rules = (config.rules || []).slice()
  const idx = rules.findIndex(r => typeof r === 'string' && r.trim().toUpperCase().startsWith('MATCH'))
  const inName = 'IN-NAME,${mix},' + POOL
  idx >= 0 ? rules.splice(idx, 0, inName) : rules.push(inName)
  // 强制域名: AND+IN-NAME 圈定只影响本线路入口(不污染主线路),插到最前先于国内直连
  ${forced.length ? 'rules.unshift(' + forced.map(q).join(', ') + ')' : ''}
  config.rules = rules
  config['proxy-groups'] = (config['proxy-groups'] || []).concat(sub).concat([
    { name: POOL, type: 'select', proxies: members },
    { name: GLOB, type: 'select', proxies: members },
  ])
  config.listeners = (config.listeners || []).concat([
    { name: ${q(mix)}, type: 'mixed', listen: '0.0.0.0', port: ${base}, udp: true },
    { name: ${q(glb)}, type: 'mixed', listen: '0.0.0.0', port: ${glob}, proxy: GLOB, udp: true },
  ])
  return config
}`
}

async function discover() {
  const data = await rest('GET', '/proxies')
  const lines = new Map()
  for (const [name, g] of Object.entries(data.proxies)) {
    const m = /^(.+?)·(通用|全局)\[(\d+)\]$/.exec(name)
    if (!m || !g.all) continue
    const [, prefix, kind, port] = m
    if (!lines.has(prefix)) lines.set(prefix, { prefix })
    const L = lines.get(prefix)
    if (kind === '通用') {
      L.base = +port
      L.mix = name
      L.mixNow = g.now
    } else {
      L.globPort = +port
      L.glob = name
      L.globNow = g.now
    }
  }
  return [...lines.values()].filter((l) => l.base || l.globPort)
}

const doorOpen = (port) =>
  new Promise((r) => {
    const s = net.connect({ host: HOST, port, timeout: 1500 })
    s.on('connect', () => {
      s.destroy()
      r(true)
    })
    s.on('error', () => r(false))
    s.on('timeout', () => {
      s.destroy()
      r(false)
    })
  })

function proxyGet(port, urlStr, tmo) {
  return new Promise((resolve) => {
    const u = new URL(urlStr)
    const req = http.request(
      {
        host: HOST,
        port,
        method: 'GET',
        path: urlStr,
        headers: { Host: u.host, 'User-Agent': 'curl/8.5.0' }
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve(d))
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(tmo ?? 9000, () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

// 经口对 https 站做 CONNECT+TLS+GET,返回状态码(0=连接/TLS 被掐)
function proxyHttpsStatus(port, hostname, tmo = 12000) {
  return new Promise((resolve) => {
    const req = http.request({
      host: HOST,
      port,
      method: 'CONNECT',
      path: hostname + ':443',
      headers: { Host: hostname + ':443', 'User-Agent': 'curl/8.5.0' }
    })
    const fin = (v) => {
      try {
        req.destroy()
      } catch {
        /* 忽略: 配置缺失或已销毁 */
      }
      resolve(v)
    }
    req.setTimeout(tmo, () => fin(0))
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return fin(res.statusCode)
      const tls = tlsLib.connect(
        { socket, servername: hostname, rejectUnauthorized: false },
        () => {
          tls.write(
            `GET / HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: close\r\n\r\n`
          )
        }
      )
      let head = ''
      tls.on('data', (d) => {
        head += d.toString('latin1')
        const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(head)
        if (m) {
          try {
            tls.destroy()
          } catch {
            /* 忽略: 配置缺失或已销毁 */
          }
          resolve(+m[1])
        }
      })
      tls.on('error', () => resolve(0))
      tls.setTimeout(tmo, () => {
        try {
          tls.destroy()
        } catch {
          /* 忽略: 配置缺失或已销毁 */
        }
        resolve(0)
      })
    })
    req.on('error', () => resolve(0))
    req.end()
  })
}

// 双源: 3322 已停服; ipip.net 需 15s + UA
async function cnIp(port) {
  let r = await proxyGet(port, 'http://members.3322.org/dyndns/getip')
  if (r) return r.trim()
  r = await proxyGet(port, 'http://myip.ipip.net', 15000)
  if (r && /来自/.test(r)) return (r.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1] || null
  return null
}

const usage = () =>
  log(`用法:
  node lines.mjs list
  node lines.mjs add <PREFIX> <base端口> '<节点名正则>' [强制域名,逗号分隔] [--flat]
     --flat: 入口组直接挂节点(旧前端不支持嵌套子组时用);默认生成 自动/故障/手动 子组
     例:  add KR 9998 '韩国|Korea|首尔|KR'
          add AU 17890 '澳洲|Australia|🇦🇺' 'xiaohongshu.com,xhscdn.com'
          add AU 17890 '澳洲|Australia|🇦🇺' --flat
  node lines.mjs remove <PREFIX>
  node lines.mjs push <js文件> <覆写id> [显示名]   推仓库里的覆写源码(幂等; 见 overrides/)
  node lines.mjs switch <组名含端口> '<节点名>'
  node lines.mjs verify
  node lines.mjs trace <端口> <域名>    查该域名经此口实际命中的规则与代理链`)

if (cmd === 'list') {
  const lines = await discover().catch(die)
  if (!lines.length) die('无已部署线路')
  log('PORT   组名                   当前节点')
  for (const l of lines.sort((x, y) => (x.base || 0) - (y.base || 0))) {
    if (l.base) log(`${String(l.base).padEnd(7)}${(l.mix || '').padEnd(24)}${l.mixNow || '-'}`)
    if (l.globPort)
      log(`${String(l.globPort).padEnd(7)}${(l.glob || '').padEnd(24)}${l.globNow || '-'}`)
  }
  process.exit(0)
}

if (cmd === 'add') {
  const flat = a.includes('--flat')
  const [prefix, baseStr, reStr, domainsStr] = a.filter((x) => x !== '--flat')
  if (!prefix || !baseStr || !reStr)
    die('参数: add <PREFIX> <base端口> <节点正则> [强制走池域名,逗号分隔]')
  const base = parseInt(baseStr, 10)
  if (!/^\d+$/.test(baseStr) || base < 1024) die('base 端口非法')
  const forceDomains = (domainsStr || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  if (forceDomains.some((d) => !/^[\w.-]+$/.test(d))) die('域名非法: ' + forceDomains.join(','))
  const data = await rest('GET', '/proxies').catch(die)
  const re = new RegExp(reStr, 'i')
  const hit = Object.keys(data.proxies).filter((n) => re.test(n) && !data.proxies[n].all)
  log(
    `正则命中 ${hit.length} 个节点${hit.length ? ': ' + hit.slice(0, 3).join(' / ') + (hit.length > 3 ? ' ...' : '') : ''}`
  )
  if (hit.length < 1) die('订阅里没有匹配节点,先核正则')
  const { ws, call } = await bridge().catch((e) => die(e.message))
  const id = `${prefix.toLowerCase()}-two-lines`
  try {
    await call('removeOverrideItem', id)
  } catch {
    /* 忽略: 配置缺失或已销毁 */
  }
  await call('addOverrideItem', {
    id,
    name: `${prefix} 双口 通用${base}/全局${base + 1}${flat ? '(平铺)' : ''}`,
    type: 'local',
    ext: 'js',
    global: true,
    file: overrideSrc(prefix, base, reStr, forceDomains, flat)
  })
  await call('restartCore')
  log(
    `覆写已写(${flat ? '平铺: 入口组直接挂节点' : '嵌套: 入口组挂 自动/故障/手动 子组'}): ${prefix}·通用[${base}](分流) + ${prefix}·全局[${base + 1}](全局), 内核已重启`
  )
  if (forceDomains.length) log(`强制走池域名: ${forceDomains.join(', ')}(规则已插到最前)`)
  ws.close()
  const ok1 = await doorOpen(base),
    ok2 = await doorOpen(base + 1)
  if (ok1 && ok2) {
    log('端口门已开, 线路可用')
    process.exit(0)
  }
  log(
    `门未开(${base}:${ok1 ? '开' : '关'} ${base + 1}:${ok2 ? '开' : '关'}) — 服务器上给 docker-compose.override.yml 的 ports 追加:\n      - '${base}:${base}'\n      - '${base + 1}:${base + 1}'\n  然后 docker compose up -d party`
  )
  process.exit(0)
}

// push: 把仓库里存的覆写源码推到目标机(幂等: 同 id 原地更新, 不必先删)
// 支持 .js 与 .yaml/.yml 两种覆写(按后缀推断 ext)
if (cmd === 'push') {
  const [file, id, name] = a
  if (!file || !id) die('参数: push <js|yaml文件> <覆写id> [显示名]')
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch (e) {
    die(`读不到覆写文件 ${file}: ${e.message}`)
  }
  const ext = /\.ya?ml$/i.test(file) ? 'yaml' : 'js'
  if (ext === 'js' && !/function\s+main\s*\(/.test(src))
    die(`不是合法覆写(缺 function main): ${file}`)
  const { ws, call } = await bridge().catch((e) => die(e.message))
  await call('addOverrideItem', {
    id,
    name: name || id,
    type: 'local',
    ext,
    global: true,
    file: src
  })
  await call('restartCore')
  log(`覆写已推送: ${id} (${name || id}) [${ext}] ${src.length} 字符, 内核已重启`)
  if (ext === 'js')
    log(
      `核对执行结果: docker exec <party容器> cat /data/.config/mihomo-party-dev/override/${id}.log`
    )
  else log(`核对生效: node lines.mjs list 或 REST /rules 看 InName 规则`)
  ws.close()
  process.exit(0)
}

if (cmd === 'remove') {
  const [prefix] = a
  if (!prefix) die('参数: remove <PREFIX>')
  const { ws, call } = await bridge().catch((e) => die(e.message))
  try {
    await call('removeOverrideItem', `${prefix.toLowerCase()}-two-lines`)
  } catch {
    die('覆写不存在')
  }
  await call('restartCore')
  log(`已移除 ${prefix} 线路(覆写删+内核重启)。端口映射若不再需要,手动删 override.yml 对应行`)
  ws.close()
  process.exit(0)
}

if (cmd === 'switch') {
  const [group, node] = a
  if (!group || !node) die('参数: switch <组名含端口> <节点名>')
  await rest('PUT', `/proxies/${encodeURIComponent(group)}`, { name: node }).catch((e) =>
    die(e.message)
  )
  log(`已切换 ${group} -> ${node}`)
  process.exit(0)
}

if (cmd === 'verify') {
  const lines = await discover().catch(die)
  if (!lines.length) die('无已部署线路')
  log('PORT   组名                   国外出口  国内出口(应直连)      小红书(经节点)')
  for (const l of lines) {
    // 参照=全局口访问国内站的出口(全局口一切流量走节点,故即节点IP);不可用 ip-api(会被分流进池混淆)
    const ref = l.globPort ? await cnIp(l.globPort) : null
    for (const [port, name] of [
      [l.base, l.mix],
      [l.globPort, l.glob]
    ]) {
      if (!port) continue
      const foreign = (
        (await proxyGet(port, 'http://ip-api.com/line/?fields=countryCode')) || '?'
      ).trim()
      const cnip = await cnIp(port)
      const cnOut = cnip ? (cnip === ref ? '走了代理!' : '直连(' + cnip + ')') : '?'
      // 小红书只对全局口有意义(分流口命中国内直连,测的是家宽)
      const xhs =
        port === l.globPort
          ? await (async () => {
              const c = await proxyHttpsStatus(port, 'www.xiaohongshu.com')
              return c ? c + (c < 400 ? '(过)' : '') : 'TLS被掐'
            })()
          : '-'
      log(
        `${String(port).padEnd(7)}${(name || '').padEnd(24)}${foreign.padEnd(9)} ${(cnOut || '?').padEnd(20)} ${xhs}`
      )
    }
  }
  process.exit(0)
}

if (cmd === 'trace') {
  // 发一个 CONNECT 挂住连接,再从 /connections 抓它实际命中的规则和链路
  const [portStr, hostStr] = a
  const hostname = (hostStr || '').replace(/^https?:\/\//i, '').split('/')[0]
  const port = parseInt(portStr, 10)
  if (!port || !hostname) die('参数: trace <端口> <域名>')
  const t0 = Date.now()
  let socket
  const conn = http.request({
    host: HOST,
    port,
    method: 'CONNECT',
    path: hostname + ':443',
    headers: { 'User-Agent': 'curl/8.5.0' }
  })
  conn.on('connect', (res, s) => {
    socket = s
  })
  conn.on('error', () => {})
  conn.end()
  await new Promise((r) => setTimeout(r, 2500))
  const data = await rest('GET', '/connections').catch(die)
  socket?.destroy()
  const hit = (data.connections || []).filter(
    (c) => (c.metadata.host || '').includes(hostname) && c.start * 1000 >= t0 - 2000
  )
  if (!hit.length) {
    log('未捕获到连接(可能瞬间完成),再跑一次')
    process.exit(0)
  }
  const c = hit[hit.length - 1]
  log(`${hostname} @ ${port}
  命中规则: ${c.rule},${c.rulePayload}
  链路: ${(c.chains || []).join(' <- ')}`)
  process.exit(0)
}

usage()
