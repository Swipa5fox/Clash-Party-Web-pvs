import { describe, expect, it } from 'vitest'
import { asyncHandlers, syncHandlers } from './ipc'
import { WEB_INVOKE_CHANNELS } from '../../shared/ipcChannels'

// 浏览器 IPC shim 的白名单必须与主进程 handler 注册表双向一致：
// 漏登记表现为 UI 侧 invoke 直接 reject「Invalid invoke channel」而主进程毫无感知
// （2026-10-08 流量通道漏登记，页面静默显示 0）。
describe('IPC channel allowlist alignment', () => {
  const registered = new Set([...Object.keys(asyncHandlers), ...Object.keys(syncHandlers)])
  const allowlisted = new Set(WEB_INVOKE_CHANNELS)

  it('every registered handler is reachable from the browser', () => {
    const missing = [...registered].filter((c) => !allowlisted.has(c))
    expect(missing).toEqual([])
  })

  it('every allowlisted channel has a handler', () => {
    const stale = [...allowlisted].filter((c) => !registered.has(c))
    expect(stale).toEqual([])
  })
})
