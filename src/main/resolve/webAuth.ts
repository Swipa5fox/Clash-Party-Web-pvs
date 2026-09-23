import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'

// Web 端账号密码登录：凭据 scrypt 哈希后持久化到 dataDir/web-auth.json，
// 会话与失败限速存内存（服务重启即全部失效，重新登录即可）。

export const WEB_AUTH_COOKIE = 'cp_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

// 防爆破：同一 IP 连续失败 5 次锁定 60 秒
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 60 * 1000

interface WebAuthConfig {
  username: string
  salt: string
  hash: string
}

let cachedConfig: WebAuthConfig | null = null
const sessions = new Map<string, number>() // sid -> expiresAt
const loginFailures = new Map<string, { count: number; lockedUntil: number }>()

function authFilePath(): string {
  return path.join(dataDir(), 'web-auth.json')
}

function hashPassword(username: string, password: string): WebAuthConfig {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return { username, salt, hash }
}

// 长度不同的输入直接判否：timingSafeEqual 对长度不一致的缓冲区会抛异常
function safeEqualBytes(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return timingSafeEqual(bufA, bufB)
}

// 读取凭据文件；不存在或损坏时生成默认 admin/admin123 并写盘
export async function ensureWebAuthConfig(): Promise<WebAuthConfig> {
  if (cachedConfig) return cachedConfig
  const file = authFilePath()
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as WebAuthConfig
      if (parsed?.username && parsed?.salt && parsed?.hash) {
        cachedConfig = parsed
        return cachedConfig
      }
    } catch {
      // 损坏的凭据文件：落回默认凭据并重写
    }
  }
  cachedConfig = hashPassword('admin', 'admin123')
  await writeFile(file, JSON.stringify(cachedConfig, null, 2), 'utf8')
  return cachedConfig
}

// 校验账号密码（含按 IP 限速）；成功时清零该 IP 的失败计数
export async function verifyWebLogin(
  username: string,
  password: string,
  clientIp: string
): Promise<{ ok: boolean; lockedSeconds?: number }> {
  const now = Date.now()
  const failure = loginFailures.get(clientIp)
  if (failure && failure.lockedUntil > now) {
    return { ok: false, lockedSeconds: Math.ceil((failure.lockedUntil - now) / 1000) }
  }

  const config = await ensureWebAuthConfig()
  const usernameOk = safeEqualBytes(username, config.username)
  const hashOk = safeEqualBytes(scryptSync(password, config.salt, 32).toString('hex'), config.hash)
  const ok = usernameOk && hashOk

  if (ok) {
    loginFailures.delete(clientIp)
    return { ok: true }
  }

  const count = (failure?.count ?? 0) + 1
  if (count >= MAX_LOGIN_FAILURES) {
    loginFailures.set(clientIp, { count, lockedUntil: now + LOGIN_LOCK_MS })
  } else {
    loginFailures.set(clientIp, { count, lockedUntil: 0 })
  }
  return { ok: false }
}

// ---- 会话管理（内存表，滑动过期） ----

export function createSessionId(): string {
  const sid = randomBytes(24).toString('base64url')
  sessions.set(sid, Date.now() + SESSION_TTL_MS)
  return sid
}

// 校验并滑动续期
export function isValidSession(sid: string | null | undefined): boolean {
  if (!sid) return false
  const expiresAt = sessions.get(sid)
  if (expiresAt === undefined) return false
  if (Date.now() > expiresAt) {
    sessions.delete(sid)
    return false
  }
  sessions.set(sid, Date.now() + SESSION_TTL_MS)
  return true
}

export function parseSidFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === WEB_AUTH_COOKIE) {
      return part.slice(eq + 1).trim() || null
    }
  }
  return null
}

// ---- 登录页（主进程内联，不依赖 Vite 构建，dev/prod 行为一致） ----

export const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clash Party - Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: hsl(240 6% 10%); color: hsl(0 0% 98%);
    font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  }
  .card {
    width: 360px; padding: 40px 36px; border-radius: 16px;
    background: hsl(240 5% 14%); border: 1px solid hsl(240 5% 22%);
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
  }
  h1 { font-size: 20px; text-align: center; margin-bottom: 6px; }
  .sub { font-size: 13px; color: hsl(240 5% 65%); text-align: center; margin-bottom: 28px; }
  label { display: block; font-size: 13px; color: hsl(240 5% 70%); margin: 14px 0 6px; }
  input {
    width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 14px;
    border: 1px solid hsl(240 5% 26%); background: hsl(240 6% 10%); color: inherit; outline: none;
  }
  input:focus { border-color: hsl(200 90% 55%); }
  button {
    width: 100%; margin-top: 24px; padding: 11px 0; border: none; border-radius: 8px;
    background: hsl(200 90% 50%); color: #fff; font-size: 15px; cursor: pointer;
  }
  button:hover { background: hsl(200 90% 45%); }
  button:disabled { opacity: .6; cursor: not-allowed; }
  .tip { min-height: 18px; margin-top: 14px; font-size: 13px; color: hsl(0 84% 64%); text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>Clash Party</h1>
    <div class="sub">Web 控制台登录</div>
    <form id="form">
      <label for="username">账号</label>
      <input id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="btn" type="submit">登 录</button>
      <div class="tip" id="tip"></div>
    </form>
  </div>
<script>
  var form = document.getElementById('form');
  var btn = document.getElementById('btn');
  var tip = document.getElementById('tip');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true;
    tip.textContent = '';
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      if (r.status === 200 && r.data && r.data.ok) {
        location.href = '/';
        return;
      }
      btn.disabled = false;
      tip.textContent = (r.data && r.data.message) || '账号或密码错误';
    }).catch(function () {
      btn.disabled = false;
      tip.textContent = '网络错误，请重试';
    });
  });
</script>
</body>
</html>
`
