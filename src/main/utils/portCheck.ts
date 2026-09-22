import net from 'net'
import { createLogger } from './logger'

const portCheckLogger = createLogger('PortCheck')

// 单次 TCP 连接探测超时(ms)：宿主机不应答时不能拖慢保存流程
const CONNECT_TIMEOUT = 800

// 本机回环/通配地址：这些已被 bindTest 覆盖，无需再做连接探测
const LOCAL_HOSTS = new Set(['', '0.0.0.0', '127.0.0.1', 'localhost', '::1', '::'])

function describeError(error: NodeJS.ErrnoException): string {
  return error.code || error.message || 'unknown'
}

// 试绑 0.0.0.0:port。app 与内核在同网络命名空间，绑定失败即内核自身端口或本机其它服务已占用。
function bindTest(port: number): Promise<{ occupied: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const server = net.createServer()
    let settled = false
    const finish = (occupied: boolean, detail?: string): void => {
      if (settled) return
      settled = true
      server.removeAllListeners()
      server.close()
      resolve({ occupied, detail })
    }
    server.once('error', (error: NodeJS.ErrnoException) => finish(true, describeError(error)))
    server.once('listening', () => finish(false))
    try {
      // exclusive: Windows 上以 SO_EXCLUSIVEADDRUSE 绑定，端口已被占用时可靠报错
      server.listen({ port, host: '0.0.0.0', exclusive: true })
    } catch (error) {
      finish(true, describeError(error as NodeJS.ErrnoException))
    }
  })
}

// 连接探测：docker bridge 模式下宿主机端口占用不在容器命名空间内，试绑发现不了，只能连它才能发现。
function connectTest(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(CONNECT_TIMEOUT)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/**
 * 探测端口是否已被占用：
 * 1. 先在本机(内核所在命名空间)试绑，命中内核自身端口或容器内其它服务；
 * 2. 再对调用方给的宿主机地址做连接探测，命中宿主机/其它容器已发布的服务——
 *    bridge 网络下这类占用试绑发现不了，但会导致端口映射失败、流量被别的服务抢走。
 */
export async function checkPortOccupied(
  port: number,
  extraHosts: string[] = []
): Promise<IPortCheckResult> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { occupied: false, detail: 'invalid port' }
  }

  const local = await bindTest(port)
  if (local.occupied) {
    return { occupied: true, source: 'local', detail: local.detail }
  }

  const hosts = [
    ...new Set(
      extraHosts.map((host) => host.trim().toLowerCase()).filter((host) => !LOCAL_HOSTS.has(host))
    )
  ]
  for (const host of hosts) {
    if (await connectTest(host, port)) {
      portCheckLogger.info(`Port ${port} answered by remote host ${host}`)
      return { occupied: true, source: 'remote', detail: host }
    }
  }

  return { occupied: false }
}
