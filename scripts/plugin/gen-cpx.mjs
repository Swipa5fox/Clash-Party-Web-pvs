// Usage: node scripts/plugin/gen-cpx.mjs <loginUrl> <providerName> [site] [out.cpx]
import { writeFileSync } from 'fs'

const [loginUrl, name, site, out = 'plugin.cpx'] = process.argv.slice(2)
if (!loginUrl || !name) {
  console.error(
    'Usage: node gen-cpx.mjs <loginUrl http(s) authorize> <providerName> [site] [out.cpx]'
  )
  process.exit(1)
}
const u = new URL(loginUrl)
if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.search || u.hash) {
  console.error('loginUrl must be http(s) with no query/fragment')
  process.exit(1)
}
const descriptor = {
  magic: 'CPXF',
  v: 2,
  spec: 'cpx-plugin/2',
  loginUrl,
  provider: { name, ...(site ? { site } : {}) }
}
writeFileSync(out, JSON.stringify(descriptor, null, 2) + '\n')
console.log('wrote', out)
