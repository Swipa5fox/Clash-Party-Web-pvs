#!/usr/bin/env node
// lines.mjs — mihomo party 网关「国家双口线路」管理器
// 子命令: list | add | remove | switch | verify | trace
// add:    node lines.mjs add <PREFIX> <base端口> '<节点正则>'
// 例:     node lines.mjs add KR 9998 '韩国|Korea|Seoul|首尔|KR'
// 数据通道: 全部走 :3999 的 WS 桥 —— 登录取 cp_session 再连 /ws, invoke 白名单含
// mihomoProxies / mihomoChangeProxy, 连接流走 mihomoConnections 事件推送;
// 不依赖 gateway :8080(该栈已移除), 也不需要 PANEL_TOKEN。
// 端口: compose 为 network_mode: host, 线路口直接绑宿主机, 写覆写即生效。
// 关键不变量: 覆写源码烘焙字面量(禁止 process.env — 重载时在 app 进程执行)。
// 退出语义: 统一 main() 自然退出(不再 process.exit —— Windows 下 exit 与 undici
// WS 关闭竞态会触发 libuv 断言 `!(handle->flags & UV_HANDLE_CLOSING)`)。
import net from 'node:net'
import http from 'node:http'
import tlsLib from 'node:tls'
import { readFileSync } from 'node:fs'

// 配置加载: 环境变量 > 脚本同目录 lines.config.json > 报错
// lines.config.json 示例(不分享): {"host":"192.168.x.x","user":"admin","password":"****"}
//   user/password: Web UI 账号(v1.3+ 账号密码登录, 先 POST /api/login 拿 cp_session 再连 /ws 桥;
//                  旧版 {"host","token"} + ?token= URL 参数已失效——upgrade 阶段只认 Cookie 会话)
function loadCfg() {
  let host = process.env.LINES_HOST,
    user = process.env.LINES_USER,
    password = process.env.LINES_PASSWORD
  if (!host || !user || !password) {
    try {
      const c = JSON.parse(readFileSync(new URL('./lines.config.json', import.meta.url), 'utf8'))
      host = host || c.host
      user = user || c.user
      password = password || c.password
    } catch {
      /* 忽略: 配置缺失或已销毁 */
    }
  }
  if (!host || !user || !password) {
    console.error(
      '[lines][FAIL] 缺配置: 设 LINES_HOST/LINES_USER/LINES_PASSWORD 环境变量, 或在脚本同目录放 lines.config.json: {"host":"<ip>","user":"<user>","password":"<pass>"}'
    )
    process.exit(1)
  }
  return { host, user, password }
}
const { host: HOST, user: USER, password: PASSWORD } = loadCfg()
const [cmd, ...a] = process.argv.slice(2)
const log = console.log

// 当前桥连接，main 结束后统一关闭（见文件头「退出语义」）。
let activeWs = null

// 业务错误：抛出后由 runner 统一打印并置退出码 1。
const die = (m) => {
  throw new Error(m)
}

// 登录拿 cp_session cookie，再带 Cookie 连 WS 桥（v1.3+ 同源会话鉴权）。
// 返回 { call, nextEvent }：call 调 IPC（白名单通道），nextEvent 等一次事件推送。
async function bridge() {
  const loginRes = await fetch(`http://${HOST}:3999/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD })
  })
  if (!loginRes.ok) {
    throw new Error(`登录失败(${loginRes.status}, 账号/密码见 lines.config.json)`)
  }
  const setCookie = loginRes.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0] // "cp_session=<sid>"
  const ws = new WebSocket(`ws://${HOST}:3999/ws`, { headers: { Cookie: cookie } })
  activeWs = ws
  const pending = new Map()
  const waiters = new Map() // channel -> resolve 队列（nextEvent 用）
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.type === 'result' && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) p.resolve(m.data)
      else p.reject(new Error(m.error))
      return
    }
    if (m.type === 'event') {
      const q = waiters.get(m.channel)
      if (q?.length) q.shift()(m.payload)
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
      if (JSON.parse(e.data).type === 'hello') ok()
    })
    ws.addEventListener('error', () => {
      clearTimeout(t)
      rej(new Error('WS 连接失败(cookie/3999?)'))
    })
  })
  const call = (ch, ...args) =>
    new Promise((resolve, reject) => {
      const id = 'c' + Math.random().toString(36).slice(2)
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ type: 'invoke', id, channel: ch, args }))
    })
  // 等该 channel 的下一次推送（内核对 /connections 等流约 1s 一帧）。
  const nextEvent = (channel, timeoutMs = 6000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`等 ${channel} 事件超时(${timeoutMs}ms)`)),
        timeoutMs
      )
      const q = waiters.get(channel) ?? []
      q.push((payload) => {
        clearTimeout(timer)
        resolve(payload)
      })
      waiters.set(channel, q)
    })
  return { call, nextEvent }
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

// 已部署线路发现: 从内核代理表里捞出 <前缀>·通用[口] / <前缀>·全局[口] 两个入口组。
async function discover(call) {
  const data = await call('mihomoProxies')
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

async function main() {
  if (cmd === 'list') {
    const { call } = await bridge()
    const lines = await discover(call)
    if (!lines.length) die('无已部署线路')
    log('PORT   组名                   当前节点')
    for (const l of lines.sort((x, y) => (x.base || 0) - (y.base || 0))) {
      if (l.base) log(`${String(l.base).padEnd(7)}${(l.mix || '').padEnd(24)}${l.mixNow || '-'}`)
      if (l.globPort)
        log(`${String(l.globPort).padEnd(7)}${(l.glob || '').padEnd(24)}${l.globNow || '-'}`)
    }
    return
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
    const { call } = await bridge()
    const data = await call('mihomoProxies')
    const re = new RegExp(reStr, 'i')
    const hit = Object.keys(data.proxies).filter((n) => re.test(n) && !data.proxies[n].all)
    log(
      `正则命中 ${hit.length} 个节点${hit.length ? ': ' + hit.slice(0, 3).join(' / ') + (hit.length > 3 ? ' ...' : '') : ''}`
    )
    if (hit.length < 1) die('订阅里没有匹配节点,先核正则')
    const id = `${prefix.toLowerCase()}-two-lines`
    try {
      await call('removeOverrideItem', id)
    } catch {
      /* 忽略: 覆写不存在 */
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
    const ok1 = await doorOpen(base),
      ok2 = await doorOpen(base + 1)
    if (ok1 && ok2) log('端口门已开, 线路可用')
    else
      log(
        `端口未监听(${base}:${ok1 ? '开' : '关'} ${base + 1}:${ok2 ? '开' : '关'}) — 检查容器在跑、端口未被占用; host 模式下线路口即写即生效, 无需映射`
      )
    return
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
    const { call } = await bridge()
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
    if (ext === 'js') log(`核对执行结果: docker exec <party容器> cat /data/override/${id}.log`)
    else log(`核对生效: node lines.mjs list 或列表里看组内成员`)
    return
  }

  if (cmd === 'remove') {
    const [prefix] = a
    if (!prefix) die('参数: remove <PREFIX>')
    const { call } = await bridge()
    try {
      await call('removeOverrideItem', `${prefix.toLowerCase()}-two-lines`)
    } catch {
      die('覆写不存在')
    }
    await call('restartCore')
    log(`已移除 ${prefix} 线路(覆写删+内核重启)`)
    return
  }

  if (cmd === 'switch') {
    const [group, node] = a
    if (!group || !node) die('参数: switch <组名含端口> <节点名>')
    const { call } = await bridge()
    await call('mihomoChangeProxy', group, node)
    log(`已切换 ${group} -> ${node}`)
    return
  }

  if (cmd === 'verify') {
    const { call } = await bridge()
    const lines = await discover(call)
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
    return
  }

  if (cmd === 'trace') {
    // 发一个 CONNECT 挂住连接,再从 mihomoConnections 事件流抓它实际命中的规则和链路
    const [portStr, hostStr] = a
    const hostname = (hostStr || '').replace(/^https?:\/\//i, '').split('/')[0]
    const port = parseInt(portStr, 10)
    if (!port || !hostname) die('参数: trace <端口> <域名>')
    const { nextEvent } = await bridge()
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
    // 内核 /connections 流约 1s 一帧,最多等 3 帧(CONNECT 已先发出,连接会出现在后续帧里)
    // start 字段历史上是 unix 秒,新版内核是 RFC3339 字符串 —— 两种都归一成毫秒再比。
    const startMs = (s) => {
      const n = Number(s)
      if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000
      const t = Date.parse(s)
      return Number.isNaN(t) ? 0 : t
    }
    let hit = []
    for (let i = 0; i < 3 && !hit.length; i++) {
      const data = await nextEvent('mihomoConnections', 6000)
      hit = (data.connections || []).filter(
        (c) => (c.metadata.host || '').includes(hostname) && startMs(c.start) >= t0 - 2000
      )
    }
    socket?.destroy()
    if (!hit.length) {
      log(`未捕获到连接(可能瞬间完成或未命中),再跑一次;也可用 list 看线路组当前节点`)
      return
    }
    const c = hit[hit.length - 1]
    log(`${hostname} @ ${port}
  命中规则: ${c.rule},${c.rulePayload}
  链路: ${(c.chains || []).join(' <- ')}`)
    return
  }

  usage()
}

try {
  await main()
} catch (e) {
  console.error('[lines][FAIL] ' + (e?.message ?? e))
  process.exitCode = 1
} finally {
  try {
    activeWs?.close()
  } catch {
    /* 忽略: 已关闭 */
  }
}
