import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

// 纯 Node 运行时（原 Electron app API 的最小替代）。
// 三种运行布局共用一套探测：
//   dev（tsx 源码）: repo/src/main → 根 = repo
//   repo 内产物:     repo/dist/server.cjs → 根 = repo
//   tarball 部署:    clash-party/server.cjs → 根 = clash-party/
//
// 生产 bundle 是 CJS（有 __dirname），dev 的 tsx 按包内 "type": "module"
// 以 ESM 跑源码（没有 __dirname），用 import.meta.url 兜底两者。

const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))

function findRoot(): string {
  // 依序探测：bundle 旁（tarball 布局，server.cjs 与 package.json 同级）→
  // 上两级（repo 内跑 dist/server.cjs）→ 上级（tsx 源码 src/main）。
  for (const cand of [resolve(here), resolve(here, '..'), resolve(here, '../..')]) {
    if (existsSync(join(cand, 'package.json'))) return cand
  }
  return resolve(here)
}

const root = findRoot()

export function installRoot(): string {
  return root
}

export function isDevMode(): boolean {
  // 源码运行（未 bundle）：本文件仍位于 src/main 下。
  return existsSync(join(root, 'src', 'main'))
}

export function rendererRoot(): string {
  // tarball: 根/renderer；repo: 构建产物 dist/renderer。
  const bundled = join(root, 'renderer')
  if (existsSync(bundled)) return bundled
  return join(root, 'dist', 'renderer')
}

let cachedVersion: string | null = null

export function appVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
      version?: string
    }
    cachedVersion = pkg.version || '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

export function systemLocale(): 'zh-CN' | 'en-US' {
  const locale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ''
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
