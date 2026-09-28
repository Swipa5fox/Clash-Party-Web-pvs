import { readFileSync, writeFileSync } from 'fs'
import { getProcessedVersion, isDevBuild } from './version-utils.mjs'

// 更新package.json中的版本号
const packagePath = 'package.json'
const packageData = JSON.parse(readFileSync(packagePath, 'utf-8'))
const newVersion = getProcessedVersion()

console.log(`当前版本: ${packageData.version}`)
console.log(`${isDevBuild() ? 'Dev构建' : '正式构建'} - 新版本: ${newVersion}`)

packageData.version = newVersion
writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n')

console.log(`✅ package.json版本号已更新为: ${newVersion}`)
