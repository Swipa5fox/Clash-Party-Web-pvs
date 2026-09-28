import { build } from 'esbuild'

// 主进程打包：src/main/index.ts → dist/server.cjs（单文件，含全部生产依赖）。
// 生产依赖全部打进 bundle，tarball 无需携带 node_modules；
// 仅原生模块保持 external：
//   - bufferutil/utf-8-validate：ws 的可选原生加速，缺省自动降级
// （sysproxy 原生绑定不经模块系统加载，走 extra/sidecar 直读 .node 文件）
const externals = ['bufferutil', 'utf-8-validate']

const result = await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/server.cjs',
  external: externals,
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  metafile: true,
  define: {
    'process.env.CP_RENDERER_URL': 'undefined'
  }
})

const inputs = Object.keys(result.metafile.inputs)
console.log(`server.cjs built from ${inputs.length} source files`)
