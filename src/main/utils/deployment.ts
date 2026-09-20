import { existsSync } from 'fs'

// 容器部署（deploy/party Docker 镜像）检测。
// Docker 会在容器根目录创建 /.dockerenv；该标记在 cpx-party 镜像内恒存在。
// 容器内没有宿主机桌面环境（GNOME/KDE/NetworkManager、TUN 设备、托盘等），
// 系统代理与 TUN 等宿主机级能力需要据此优雅降级，而不是让原生调用报错。
let cachedContainer: boolean | undefined

export function isContainerDeployment(): boolean {
  if (cachedContainer === undefined) {
    try {
      cachedContainer = process.platform === 'linux' && existsSync('/.dockerenv')
    } catch {
      cachedContainer = false
    }
  }
  return cachedContainer
}

export type DeploymentEnv = 'desktop' | 'container'

export function getDeploymentEnv(): DeploymentEnv {
  return isContainerDeployment() ? 'container' : 'desktop'
}

// 仅供测试重置缓存
export function resetDeploymentCacheForTest(): void {
  cachedContainer = undefined
}
