import React, { useRef, useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, useDisclosure } from '@heroui/react'
import {
  exportLocalBackupBase64,
  importLocalBackupFromContent,
  restartCore
} from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import BaseConfirmModal from '../base/base-confirm-modal'

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const LocalBackupConfig: React.FC = () => {
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      // 内容直传通道：取回 base64 后在渲染层触发浏览器下载（web/桌面统一）
      const base64 = await exportLocalBackupBase64()
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `clash-party-backup-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      new window.Notification(t('localBackup.notification.exportSuccess.title'), {
        body: t('localBackup.notification.exportSuccess.body')
      })
    } catch (e) {
      toast.error(String(e))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = (): void => {
    onClose()
    importInputRef.current?.click()
  }

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setImporting(true)
    try {
      // 内容直传通道：读取 zip 为 base64 后交主进程恢复（web/桌面统一）
      await importLocalBackupFromContent(await readFileAsBase64(file))
      window.electron.ipcRenderer.send('updateAppConfig')
      window.electron.ipcRenderer.send('appConfigUpdated')
      window.electron.ipcRenderer.send('controledMihomoConfigUpdated')
      window.electron.ipcRenderer.send('profileConfigUpdated')

      try {
        await restartCore()
      } catch (error) {
        console.error('Failed to restart core after import:', error)
        toast.error(t('common.error.restartCoreFailed', { error: error }))
      }

      new window.Notification(t('localBackup.notification.importSuccess.title'), {
        body: t('localBackup.notification.importSuccess.body')
      })
    } catch (e) {
      toast.error(t('common.error.importFailed', { error: e }))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <BaseConfirmModal
        isOpen={isOpen}
        onCancel={onClose}
        onConfirm={handleImport}
        title={t('localBackup.import.confirm.title')}
        content={t('localBackup.import.confirm.body')}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void handleImportFile(file)
        }}
      />
      <SettingCard title={t('localBackup.title')}>
        <SettingItem title={t('localBackup.export.title')} divider>
          <Button isLoading={exporting} size="sm" onPress={handleExport}>
            {t('localBackup.export.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('localBackup.import.title')}>
          <Button isLoading={importing} size="sm" onPress={onOpen}>
            {t('localBackup.import.button')}
          </Button>
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default LocalBackupConfig
