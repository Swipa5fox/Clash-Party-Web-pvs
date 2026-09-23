/// <reference types="vite/client" />

// window.electron / window.api 全局类型：由浏览器端 IPC shim（src/renderer/src/web/main-web.ts）挂载
import type { webUtils } from 'electron'

type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void

interface SafeIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, listener: IpcListener) => void
  removeListener: (channel: string, listener: IpcListener) => void
  removeAllListeners: (channel: string) => void
}

interface ElectronAPI {
  ipcRenderer: SafeIpcRenderer
  process: {
    platform: NodeJS.Platform
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: { webUtils: typeof webUtils }
  }
}
