import { toast } from '@renderer/components/base/toast'
import i18next from 'i18next'

const DETAILED_ERROR_KEYWORDS = [
  'yaml',
  'YAML',
  'config',
  'profile',
  'parse',
  'syntax',
  'invalid',
  'failed to',
  'connection refused',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'certificate',
  'SSL',
  'TLS',
  'Permission denied',
  'Access denied',
  '配置',
  '解析',
  '失败',
  '权限',
  '证书'
]

function shouldShowDetailedError(message: string): boolean {
  if (message.length > 80) return true
  if (message.includes('\n')) return true
  return DETAILED_ERROR_KEYWORDS.some((keyword) => message.includes(keyword))
}

export async function showError(error: unknown, title?: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const defaultTitle = i18next.t('common.error.default')

  if (shouldShowDetailedError(message)) {
    toast.detailedError(message, title || defaultTitle)
  } else {
    toast.error(message, title)
  }
}

export function showErrorSync(error: unknown, title?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const defaultTitle = i18next.t('common.error.default')

  if (shouldShowDetailedError(message)) {
    toast.detailedError(message, title || defaultTitle)
  } else {
    toast.error(message, title)
  }
}
