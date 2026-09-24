import { execFileSync } from 'child_process'
import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir, platform } from 'os'

// 给便携版 7z 补 PORTABLE 标记：解压后数据落 exe 同级 data/（见 src/main/utils/dirs.ts）。
// 7za 优先用 electron-builder 缓存自带的那份（构建机无需另装 7-Zip），其次 PATH。
// 用法：node scripts/mark-portable.mjs [输出目录，默认 dist]
// （npm 会把 `pnpm build:win --x64` 之类的附加参数拼到命令串末尾，这里只取非开关参数）
const dirArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
const distDir = resolve(dirArg ?? 'dist')
const archives = existsSync(distDir)
  ? readdirSync(distDir).filter((name) => name.endsWith('portable.7z'))
  : []

if (archives.length === 0) {
  console.log(`[portable] ${distDir} 下无 portable.7z，跳过`)
  process.exit(0)
}

function find7za() {
  const isWin = platform() === 'win32'
  const cacheRoot = join(
    isWin
      ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : join(homedir(), '.cache'),
    'electron-builder',
    'Cache'
  )
  const candidates = []
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot).filter((name) => name.startsWith('7zip@'))) {
      const binRoot = join(cacheRoot, entry)
      for (const inner of readdirSync(binRoot)) {
        const candidate = join(binRoot, inner, 'bin', isWin ? '7za.exe' : '7za')
        if (existsSync(candidate)) candidates.push(candidate)
      }
    }
  }
  candidates.push(...(isWin ? ['7za.exe', '7z.exe'] : ['7za', '7z']))

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['i'], { stdio: 'ignore' })
      return candidate
    } catch {
      // 尝试下一个候选
    }
  }
  throw new Error('[portable] 未找到 7za/7z，请安装 7-Zip 后重试')
}

const sevenZa = find7za()
const marker = join(distDir, 'PORTABLE')
writeFileSync(marker, '')
try {
  for (const archive of archives) {
    execFileSync(sevenZa, ['a', '-y', archive, 'PORTABLE'], { cwd: distDir, stdio: 'inherit' })
    console.log(`[portable] 已写入标记: ${archive}`)
  }
} finally {
  unlinkSync(marker)
}
