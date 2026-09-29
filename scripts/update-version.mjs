import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'

// dev 构建（CI workflow_dispatch）把版本号改为 <base>-d<月日>.<commit>，正式构建保持 package.json 原值
const isDevBuild = () =>
  process.env.NODE_ENV === 'development' ||
  process.argv.includes('--dev') ||
  process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'

function devVersion(base) {
  const now = new Date()
  const monthDate = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  return `${base}-d${monthDate}.${commitHash}`
}

const packagePath = 'package.json'
const packageData = JSON.parse(readFileSync(packagePath, 'utf-8'))
const base = packageData.version.replace(/-d\d{2,4}\.[a-f0-9]{7}$/, '')
const isDev = isDevBuild()
const newVersion = isDev ? devVersion(base) : base

console.log(`当前版本: ${packageData.version}`)
console.log(`${isDev ? 'Dev构建' : '正式构建'} - 新版本: ${newVersion}`)

packageData.version = newVersion
writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n')

console.log(`✅ package.json版本号已更新为: ${newVersion}`)
