type PluginFileListener = () => void

let pendingPluginFile: IPluginFilePayload | null = null
const listeners = new Set<PluginFileListener>()

function isPluginFilePayload(value: unknown): value is IPluginFilePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as IPluginFilePayload).name === 'string' &&
    typeof (value as IPluginFilePayload).fileBytesB64 === 'string'
  )
}

window.electron.ipcRenderer.on('openPluginFile', (_event, ...args) => {
  const payload = args[0]
  if (!isPluginFilePayload(payload)) return
  pendingPluginFile = payload
  listeners.forEach((listener) => listener())
})

export function hasPendingPluginFile(): boolean {
  return pendingPluginFile !== null
}

export function takePendingPluginFile(): IPluginFilePayload | null {
  const payload = pendingPluginFile
  pendingPluginFile = null
  return payload
}

export function subscribePluginFile(listener: PluginFileListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
