import net from 'net'
import http from 'http'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'

export let pacPort: number

const defaultPacScript = `
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
`

// 绑定失败则向上试端口；直接监听正式 server，避免"先探测再绑定"的竞态
function listenOnFreePort(server: http.Server, host: string, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < 65535) {
          tryListen(port + 1)
        } else {
          reject(err)
        }
      })
      server.once('listening', () => resolve((server.address() as net.AddressInfo).port))
      server.listen(port, host)
    }
    tryListen(startPort)
  })
}

let pacServer: http.Server

export async function startPacServer(): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode = 'manual', host: cHost, pacScript } = sysProxy
  if (mode !== 'auto') {
    return
  }
  const host = cHost || '127.0.0.1'
  let script = pacScript || defaultPacScript
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  script = script.replaceAll('%mixed-port%', port.toString())
  pacServer = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
    res.end(script)
  })
  pacPort = await listenOnFreePort(pacServer, host, 10000)
}

export async function stopPacServer(): Promise<void> {
  if (pacServer) {
    pacServer.close()
  }
}
