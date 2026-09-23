// 主进程事件广播器：Web 模式下替代 mainWindow.webContents.send 的事件推送出口。
// 各模块（mihomo 流 / theme / manager / ssid 等）统一调用 broadcastEvent 推送事件，
// 由启动编排用 broadcaster.setBroadcaster(bridge.broadcast) 接线到 :3999 WS 桥，
// 面向所有已认证的 Web 客户端广播。语义对齐原 window.ts 的 setMainWindowStub 桩：
// webContents.send(channel, ...args) 只取 args[0] 作为单 payload 转发。
// 桥未接线（启动早期）时静默丢弃事件，不抛错，保证启动流程不受影响。

type BroadcastFn = (channel: string, payload?: unknown) => void

let broadcastFn: BroadcastFn | null = null

// 由启动编排调用，把广播出口接到 WS 桥的 broadcast 上
export function setBroadcaster(fn: BroadcastFn): void {
  broadcastFn = fn
}

// 推送事件到 Web 客户端；未接线时静默丢弃
export function broadcastEvent(channel: string, payload?: unknown): void {
  broadcastFn?.(channel, payload)
}
