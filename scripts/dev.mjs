import { spawn } from 'child_process'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
// Vite 7 的 exports 不再暴露 ./bin/vite.js，tsx 同理不暴露 ./dist/cli.mjs，均从包根拼真实路径。
// 两个入口都是 .mjs/.js 脚本，直接 spawn 路径会被 Windows 文件关联截胡，统一用 node 启动。
const pkgPath = (id, rel) =>
  path.join(path.dirname(require.resolve(`${id}/package.json`)), ...rel.split('/'))

const vite = spawn(
  process.execPath,
  // --host 127.0.0.1：Vite 7 默认只监听 [::1]（IPv6），桥反代连 127.0.0.1 会失败退回旧产物
  [pkgPath('vite', 'bin/vite.js'), 'dev', '--port', '5199', '--host', '127.0.0.1'],
  {
    stdio: 'inherit'
  }
)

const rendererUrl = 'http://127.0.0.1:5199'
const main = spawn(process.execPath, [pkgPath('tsx', 'dist/cli.mjs'), 'src/main/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CP_RENDERER_URL: rendererUrl,
    CP_WEB_HOST: process.env.CP_WEB_HOST || '127.0.0.1'
  }
})

const shutdown = (code) => {
  vite.kill()
  process.exit(code ?? 0)
}
main.on('exit', shutdown)
vite.on('exit', (code) => {
  if (code && code !== 0) main.kill()
})
process.on('SIGINT', () => shutdown(0))
