export interface SysproxyInfo {
  enable: boolean
  host: string
  port: number
  bypass: string
}

export interface AutoproxyInfo {
  enable: boolean
  url: string
}

export function triggerManualProxy(
  enable: boolean,
  host: string,
  port: number,
  bypass: string
): void

export function triggerAutoProxy(enable: boolean, url: string): void

export function getSystemProxy(): SysproxyInfo

export function getAutoProxy(): AutoproxyInfo

export function setSystemProxy(proxy: SysproxyInfo): void

export function setAutoProxy(proxy: AutoproxyInfo): void
