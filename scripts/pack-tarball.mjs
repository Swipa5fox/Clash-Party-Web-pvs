import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
const { c: createTar } = await import('tar')

// 组装 tar.gz 产物（无 node_modules：server.cjs 已含全部生产依赖）：
//   clash-party-<platform>-<version>-<arch>.tar.gz
//     clash-party/
//     ├ server.cjs
//     ├ package.json            （仅 name/version，供 appVersion() 读取）
//     ├ renderer/               （vite 产物）
//     ├ resources/sidecar/mihomo
//     ├ resources/files/（mmdb/geo 等）
//     └ deploy/clash-party.service（systemd unit 参考）

const ROOT = process.cwd()
const DIST = path.join(ROOT, 'dist')
const PKG_NAME = 'clash-party'
const STAGE = path.join(DIST, 'stage', PKG_NAME)

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf-8'))
const PLATFORM = process.env.BUILD_PLATFORM || process.platform
const ARCH = process.env.BUILD_ARCH || process.arch
const OUT_NAME = `clash-party-${PLATFORM}-${pkg.version}-${ARCH}.tar.gz`
const OUT_PATH = path.join(DIST, OUT_NAME)

rmSync(path.join(DIST, 'stage'), { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

function copy(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(src, dst)
}

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(path.join(src, entry.name), path.join(dst, entry.name))
    else copy(path.join(src, entry.name), path.join(dst, entry.name))
  }
}

// 1. server bundle
copy(path.join(DIST, 'server.cjs'), path.join(STAGE, 'server.cjs'))

// 2. 最小 package.json（appVersion() 读它）
writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2)
)

// 3. renderer 静态产物
copyDir(path.join(DIST, 'renderer'), path.join(STAGE, 'renderer'))

// 4. resources：mihomo 内核 + geo 文件（来自 extra/，pnpm prepare 下载）
const resDir = path.join(STAGE, 'resources')
const sidecarSrc = path.join(ROOT, 'extra', 'sidecar')
if (existsSync(sidecarSrc)) {
  copyDir(sidecarSrc, path.join(resDir, 'sidecar'))
} else {
  console.warn('[pack] warning: extra/sidecar 不存在，先运行 pnpm prepare 下载 mihomo 内核')
}
const filesSrc = path.join(ROOT, 'extra', 'files')
if (existsSync(filesSrc)) {
  copyDir(filesSrc, path.join(resDir, 'files'))
}

// 5. systemd unit
const unitSrc = path.join(ROOT, 'deploy', 'clash-party.service')
if (existsSync(unitSrc)) {
  copy(unitSrc, path.join(STAGE, 'deploy', 'clash-party.service'))
}

// 6. tar.gz + sha256（64 字节 hex 无换行）
await createTar(
  {
    cwd: path.dirname(STAGE),
    gzip: true,
    portable: true,
    file: OUT_PATH
  },
  [PKG_NAME]
)
console.log(`[pack] wrote ${path.relative(ROOT, OUT_PATH)}`)

const hash = createHash('sha256')
hash.update(await readFile(OUT_PATH))
writeFileSync(OUT_PATH + '.sha256', hash.digest('hex'))
console.log(`[pack] wrote ${path.relative(ROOT, OUT_PATH + '.sha256')}`)
