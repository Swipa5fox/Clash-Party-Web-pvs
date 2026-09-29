/// <reference types="vite/client" />

// window.electron 全局类型：由浏览器端 IPC shim（src/renderer/src/web/main-web.ts）挂载
type IpcListener = (event: unknown, ...args: unknown[]) => void

interface SafeIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: IpcListener) => void
  removeListener: (channel: string, listener: IpcListener) => void
}

declare global {
  interface Window {
    electron: { ipcRenderer: SafeIpcRenderer }
  }
}

export {}
