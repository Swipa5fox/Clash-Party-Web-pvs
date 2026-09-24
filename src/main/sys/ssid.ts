import { exec } from 'child_process'
import { promisify } from 'util'
import { getAppConfig, patchAppConfig, patchControledMihomoConfig } from '../config'
import { patchMihomoConfig } from '../core/mihomoApi'
import { broadcastEvent } from '../resolve/broadcaster'

export async function getCurrentSSID(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    try {
      return await getSSIDByNetsh()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'linux') {
    try {
      return await getSSIDByIwconfig()
    } catch {
      return undefined
    }
  }
  return undefined
}

let lastSSID: string | undefined
let ssidCheckInterval: NodeJS.Timeout | null = null

export async function checkSSID(): Promise<void> {
  try {
    const { pauseSSID = [], disableDnsOnPauseSSID = false, controlDns } = await getAppConfig()
    if (pauseSSID.length === 0) return
    const currentSSID = await getCurrentSSID()
    if (currentSSID === lastSSID) return
    lastSSID = currentSSID
    if (currentSSID && pauseSSID.includes(currentSSID)) {
      if (disableDnsOnPauseSSID) {
        // 保存当前 DNS 状态到 appConfig，然后关闭 DNS 接管
        await patchAppConfig({ controlDnsBeforePause: controlDns, controlDns: false })
      }
      await patchControledMihomoConfig({ mode: 'direct' })
      await patchMihomoConfig({ mode: 'direct' })
      broadcastEvent('controledMihomoConfigUpdated')
      broadcastEvent('appConfigUpdated')
    } else {
      // DNS 恢复逻辑已移至 patchControledMihomoConfig，会在模式从 direct 切换到 rule/global 时自动触发
      await patchControledMihomoConfig({ mode: 'rule' })
      await patchMihomoConfig({ mode: 'rule' })
      broadcastEvent('controledMihomoConfigUpdated')
      broadcastEvent('appConfigUpdated')
    }
  } catch {
    // ignore
  }
}

export async function startSSIDCheck(): Promise<void> {
  if (ssidCheckInterval) {
    clearInterval(ssidCheckInterval)
  }
  await checkSSID()
  ssidCheckInterval = setInterval(checkSSID, 30000)
}

export function stopSSIDCheck(): void {
  if (ssidCheckInterval) {
    clearInterval(ssidCheckInterval)
    ssidCheckInterval = null
  }
}

async function getSSIDByNetsh(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise('netsh wlan show interfaces')
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByIwconfig(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    `iwconfig 2>/dev/null | grep 'ESSID' | awk -F'"' '{print $2}'`
  )
  if (stdout.trim() !== '') {
    return stdout.trim()
  }
  return undefined
}
