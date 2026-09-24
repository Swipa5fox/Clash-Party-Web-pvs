import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Tooltip
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import BaseConfirmModal from '@renderer/components/base/base-confirm-modal'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { toast } from '@renderer/components/base/toast'
import QrCodeModal from '@renderer/components/profiles/qr-code-modal'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  addFileShareFile,
  getFileShareServerState,
  getFileShareUrls,
  getInterfaces,
  listFileShareFiles,
  patchAppConfig,
  renameFileShareGroup as renameFileShareGroupIpc,
  restartFileShareServer,
  revokeFileShareFile,
  setFileShareFileMeta
} from '@renderer/utils/ipc'
import dayjs from '@renderer/utils/dayjs'
import { calcTraffic } from '@renderer/utils/calc'
import { MdDeleteOutline, MdEdit, MdLink, MdOutlineFileUpload, MdQrCode2 } from 'react-icons/md'
import { IoCopy } from 'react-icons/io5'
import { IoIosArrowBack } from 'react-icons/io'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ACCEPT_EXTS = ['.yaml', '.yml', '.json', '.conf', '.txt', '.bak']

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      const dataUrl = String(reader.result)
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = (): void => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const FileShare: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { fileShare = {} } = appConfig || {}
  const { enable = false, port = 8090, host = '0.0.0.0' } = fileShare

  const [state, setState] = useState<IFileShareServerState | null>(null)
  const [files, setFiles] = useState<IFileShareFileInfo[]>([])
  const [interfaces, setInterfaces] = useState<NodeJS.Dict<NetworkInterfaceInfo[]>>({})
  const [uploading, setUploading] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [validation, setValidation] = useState<{
    file: string
    result: IFileShareValidation
  } | null>(null)
  // 文件编辑弹窗: 目标文件 + 别名/分组草稿
  const [editTarget, setEditTarget] = useState<IFileShareFileInfo | null>(null)
  const [editAlias, setEditAlias] = useState('')
  const [editGroup, setEditGroup] = useState('')
  // 组内联重命名: 目标组名 + 草稿
  const [renameGroup, setRenameGroup] = useState<string | null>(null)
  const [renameGroupInput, setRenameGroupInput] = useState('')
  // 折叠的分组名集合(含未分组哨兵 '')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextState, nextFiles] = await Promise.all([
        getFileShareServerState(),
        listFileShareFiles()
      ])
      setState(nextState)
      setFiles(nextFiles)
    } catch (e) {
      toast.error(String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    getInterfaces().then(setInterfaces)
  }, [refresh, enable, port, host])

  // updateConfig 经 ref 取最新配置值，避免 debounce/连点时把旧值写回
  const fileShareRef = useRef({ enable, port, host })
  fileShareRef.current = { enable, port, host }

  const updateConfig = async (patch: {
    enable?: boolean
    port?: number
    host?: string
  }): Promise<void> => {
    try {
      await patchAppConfig({ fileShare: { ...fileShareRef.current, ...patch } })
      await restartFileShareServer()
      await refresh()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const updateConfigRef = useRef(updateConfig)
  updateConfigRef.current = updateConfig

  // 端口逐字符输入时防抖，避免每个按键都触发一次配置写入 + 服务重启
  const portTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return (): void => {
      if (portTimerRef.current) clearTimeout(portTimerRef.current)
    }
  }, [])
  const handlePortChange = (v: string): void => {
    const parsed = parseInt(v, 10)
    if (isNaN(parsed) || parsed <= 0 || parsed >= 65536) return
    if (portTimerRef.current) clearTimeout(portTimerRef.current)
    portTimerRef.current = setTimeout(() => {
      portTimerRef.current = null
      void updateConfigRef.current({ port: parsed })
    }, 500)
  }

  const handleUpload = async (fileList: FileList | File[]): Promise<void> => {
    const list = Array.from(fileList)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        const lower = file.name.toLowerCase()
        if (!ACCEPT_EXTS.some((ext) => lower.endsWith(ext))) {
          toast.warning(t('fileShare.error.unsupportedExtToast', { name: file.name }))
          continue
        }
        try {
          const content = await fileToBase64(file)
          const result = await addFileShareFile(file.name, content)
          if (!result.added || result.file === null) {
            // 致命校验失败：未投放，展示完整校验结果
            setValidation({ file: file.name, result: result.validation })
            toast.error(t('fileShare.add.rejected'), file.name)
          } else {
            if (result.validation.issues.some((i) => i.level !== 'info')) {
              setValidation({ file: result.file, result: result.validation })
            }
            const urls = await getFileShareUrls(result.file)
            if (urls[0]) {
              await navigator.clipboard.writeText(urls[0]).catch(() => {})
              toast.success(t('fileShare.add.success', { url: urls[0] }), file.name)
            } else {
              toast.success(t('fileShare.add.successNoUrl'), file.name)
            }
          }
        } catch (e) {
          toast.error(String(e), file.name)
        }
      }
      await refresh()
    } finally {
      setUploading(false)
    }
  }

  const handleRevoke = async (): Promise<void> => {
    if (!revokeTarget) return
    try {
      await revokeFileShareFile(revokeTarget)
      toast.success(t('fileShare.revoke.success'), revokeTarget)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setRevokeTarget(null)
      await refresh()
    }
  }

  const handleCopyUrl = async (file: string): Promise<void> => {
    try {
      const urls = await getFileShareUrls(file)
      if (urls[0]) {
        await navigator.clipboard.writeText(urls[0])
        toast.success(t('common.copied'))
      }
    } catch (e) {
      toast.error(String(e))
    }
  }

  // 保存文件元数据(显示名/分组): URL 与底层文件名不变
  const handleSaveMeta = async (): Promise<void> => {
    if (!editTarget) return
    try {
      await setFileShareFileMeta(editTarget.file, { alias: editAlias, group: editGroup })
      toast.success(t('fileShare.edit.saved'))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setEditTarget(null)
      await refresh()
    }
  }

  // 分组重命名: 该组全部文件一并迁移
  const handleRenameGroup = async (): Promise<void> => {
    if (!renameGroup) return
    try {
      await renameFileShareGroupIpc(renameGroup, renameGroupInput)
      toast.success(t('fileShare.group.renamed'))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setRenameGroup(null)
      await refresh()
    }
  }

  // 按分组分桶(Map 保持首次出现顺序,未分组 '' 排末尾)
  const groupedFiles = useMemo(() => {
    const map = new Map<string, IFileShareFileInfo[]>()
    for (const info of files) {
      const key = info.group || ''
      const bucket = map.get(key)
      if (bucket) bucket.push(info)
      else map.set(key, [info])
    }
    const entries = [...map.entries()]
    const named = entries.filter(([name]) => !!name)
    const ungrouped = entries.filter(([name]) => !name)
    return [...named, ...ungrouped].map(([name, bucketFiles]) => ({ name, files: bucketFiles }))
  }, [files])

  const pageRef = useRef<HTMLDivElement>(null)

  // 拖拽处理器经 ref 转发，避免把 handleUpload 加进 dnd effect 的依赖
  const handleUploadRef = useRef(handleUpload)
  handleUploadRef.current = handleUpload

  useEffect(() => {
    const element = pageRef.current
    if (!element) return

    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(true)
    }
    const handleDragLeave = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(false)
    }
    const handleDrop = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      setFileOver(false)
      if (event.dataTransfer?.files?.length) {
        void handleUploadRef.current(event.dataTransfer.files)
      }
    }

    element.addEventListener('dragover', handleDragOver)
    element.addEventListener('dragleave', handleDragLeave)
    element.addEventListener('drop', handleDrop)
    return (): void => {
      element.removeEventListener('dragover', handleDragOver)
      element.removeEventListener('dragleave', handleDragLeave)
      element.removeEventListener('drop', handleDrop)
    }
  }, [])

  const lanIps = Object.values(interfaces)
    .flat()
    .filter(
      (info): info is NetworkInterfaceInfo => !!info && info.family === 'IPv4' && !info.internal
    )
    .map((info) => info.address)
  const hostOptions = [...new Set(['0.0.0.0', '127.0.0.1', ...lanIps])]

  const running = state?.running === true
  const statusChip = state?.error ? (
    <Chip color="danger" size="sm" variant="flat">
      {state.error}
    </Chip>
  ) : running ? (
    <Chip color="success" size="sm" variant="flat">
      {t('fileShare.status.running', { port: state?.port ?? port })}
    </Chip>
  ) : (
    <Chip color="default" size="sm" variant="flat">
      {t('fileShare.status.stopped')}
    </Chip>
  )

  return (
    <BasePage ref={pageRef} title={t('fileShare.title')}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_EXTS.join(',')}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void handleUpload(e.target.files)
          }
          e.target.value = ''
        }}
      />
      <div className={`${fileOver ? 'blur-sm' : ''}`}>
        <SettingCard title={t('fileShare.server.title')}>
          <SettingItem title={t('fileShare.server.enable')} divider>
            <Switch
              size="sm"
              isSelected={enable}
              onValueChange={(v) => {
                void updateConfig({ enable: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('fileShare.server.port')} divider>
            <Input
              size="sm"
              type="number"
              className="w-37.5"
              value={String(port)}
              onValueChange={handlePortChange}
            />
          </SettingItem>
          <SettingItem title={t('fileShare.server.host')} divider>
            <Select
              classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
              className="w-37.5"
              size="sm"
              selectedKeys={[host]}
              aria-label={t('fileShare.server.host')}
              onSelectionChange={(v) => {
                const next = Array.from(v)[0] as string
                if (next) void updateConfig({ host: next })
              }}
            >
              {hostOptions.map((option) => (
                <SelectItem key={option}>
                  {option === '0.0.0.0'
                    ? t('fileShare.server.hostAny')
                    : option === '127.0.0.1'
                      ? t('fileShare.server.hostLocal')
                      : option}
                </SelectItem>
              ))}
            </Select>
          </SettingItem>
          <SettingItem title={t('fileShare.server.status')}>{statusChip}</SettingItem>
          <div className="px-2 pb-2">
            <p className="text-xs text-foreground-500">{t('fileShare.server.hint')}</p>
          </div>
        </SettingCard>

        <Card className="m-2">
          <CardBody>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-md font-bold">{t('fileShare.list.title')}</h3>
              <div className="flex items-center gap-2">
                <Chip color="warning" size="sm" variant="flat">
                  {t('fileShare.list.model')}
                </Chip>
                <Button
                  size="sm"
                  color="primary"
                  isLoading={uploading}
                  onPress={() => {
                    fileInputRef.current?.click()
                  }}
                >
                  <MdOutlineFileUpload className="text-lg" />
                  {t('fileShare.upload.button')}
                </Button>
              </div>
            </div>
            <Divider />
            {files.length === 0 ? (
              <div className="py-8 text-center text-sm text-foreground-500">
                {t('fileShare.list.empty')}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {groupedFiles.map(({ name: groupName, files: groupFiles }) => {
                  const collapsed = collapsedGroups.has(groupName)
                  const renaming = renameGroup === groupName
                  return (
                    <div key={groupName || '__ungrouped__'}>
                      {/* 组头: 折叠 + 组名/数量 + 内联重命名(未分组不可改名) */}
                      <div className="flex items-center justify-between gap-2 rounded-medium px-2 py-1 hover:bg-default-100">
                        <div
                          className="flex min-w-0 cursor-pointer select-none items-center gap-1"
                          onClick={() => {
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(groupName)) next.delete(groupName)
                              else next.add(groupName)
                              return next
                            })
                          }}
                        >
                          <IoIosArrowBack
                            className={`h-4 w-4 text-foreground-500 transition duration-200 ${collapsed ? '' : '-rotate-90'}`}
                          />
                          <span className="truncate text-sm font-bold">
                            {groupName || t('fileShare.list.ungrouped')}
                          </span>
                          <Chip size="sm" variant="flat">
                            {groupFiles.length}
                          </Chip>
                        </div>
                        {groupName &&
                          (renaming ? (
                            <div className="flex items-center gap-1">
                              <Input
                                size="sm"
                                className="w-40"
                                placeholder={t('fileShare.group.namePlaceholder')}
                                value={renameGroupInput}
                                autoFocus
                                onValueChange={setRenameGroupInput}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleRenameGroup()
                                }}
                              />
                              <Button
                                size="sm"
                                color="primary"
                                isDisabled={
                                  !renameGroupInput.trim() || renameGroupInput.trim() === groupName
                                }
                                onPress={() => {
                                  void handleRenameGroup()
                                }}
                              >
                                {t('common.confirm')}
                              </Button>
                            </div>
                          ) : (
                            <Tooltip content={t('fileShare.group.rename')}>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                onPress={() => {
                                  setRenameGroup(groupName)
                                  setRenameGroupInput(groupName)
                                }}
                              >
                                <MdEdit className="text-lg" />
                              </Button>
                            </Tooltip>
                          ))}
                      </div>
                      {!collapsed && (
                        <div className="mt-1 flex flex-col gap-1">
                          {groupFiles.map((info) => (
                            <div
                              key={info.file}
                              className="flex items-center justify-between gap-2 rounded-medium px-2 py-1.5 hover:bg-default-100"
                            >
                              <div className="min-w-0 flex-1">
                                <p
                                  className="truncate font-mono text-sm select-all"
                                  title={info.file}
                                >
                                  {info.alias || info.file}
                                </p>
                                <p className="truncate text-xs text-foreground-500">
                                  {info.alias && <span className="font-mono">{info.file} · </span>}
                                  {calcTraffic(info.size)} ·{' '}
                                  {dayjs(info.mtime).format('YYYY-MM-DD HH:mm')}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <Tooltip content={t('fileShare.actions.edit')}>
                                  <Button
                                    isIconOnly
                                    size="sm"
                                    variant="light"
                                    onPress={() => {
                                      setEditTarget(info)
                                      setEditAlias(info.alias || '')
                                      setEditGroup(info.group || '')
                                    }}
                                  >
                                    <MdEdit className="text-lg" />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t('fileShare.actions.copyUrl')}>
                                  <Button
                                    isIconOnly
                                    size="sm"
                                    variant="light"
                                    onPress={() => {
                                      void handleCopyUrl(info.file)
                                    }}
                                  >
                                    <IoCopy className="text-lg" />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t('fileShare.actions.qr')}>
                                  <Button
                                    isIconOnly
                                    size="sm"
                                    variant="light"
                                    onPress={async () => {
                                      try {
                                        const urls = await getFileShareUrls(info.file)
                                        if (urls[0]) setQrUrl(urls[0])
                                      } catch (e) {
                                        toast.error(String(e))
                                      }
                                    }}
                                  >
                                    <MdQrCode2 className="text-lg" />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t('fileShare.actions.revoke')}>
                                  <Button
                                    isIconOnly
                                    size="sm"
                                    variant="light"
                                    color="danger"
                                    onPress={() => {
                                      setRevokeTarget(info.file)
                                    }}
                                  >
                                    <MdDeleteOutline className="text-lg" />
                                  </Button>
                                </Tooltip>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="mt-2 text-xs text-foreground-500">
              <MdLink className="inline-block mr-0.5" />
              {t('fileShare.list.usage')}
            </p>
          </CardBody>
        </Card>
      </div>

      {qrUrl !== null && <QrCodeModal url={qrUrl} onClose={() => setQrUrl(null)} />}

      <BaseConfirmModal
        isOpen={revokeTarget !== null}
        title={t('fileShare.revoke.confirmTitle')}
        content={t('fileShare.revoke.confirmContent', { file: revokeTarget || '' })}
        onCancel={() => {
          setRevokeTarget(null)
        }}
        onConfirm={() => {
          void handleRevoke()
        }}
      />

      {editTarget !== null && (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setEditTarget(null)
          }}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <span>{t('fileShare.edit.title')}</span>
              <span className="break-all font-mono text-xs font-normal text-foreground-500">
                {editTarget.file}
              </span>
            </ModalHeader>
            <ModalBody>
              <Input
                size="sm"
                label={t('fileShare.edit.alias')}
                placeholder={t('fileShare.edit.aliasPlaceholder')}
                value={editAlias}
                onValueChange={setEditAlias}
              />
              <Input
                size="sm"
                label={t('fileShare.edit.group')}
                placeholder={t('fileShare.edit.groupPlaceholder')}
                value={editGroup}
                onValueChange={setEditGroup}
              />
              <p className="text-xs text-foreground-500">{t('fileShare.edit.hint')}</p>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                variant="light"
                onPress={() => {
                  setEditTarget(null)
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                color="primary"
                onPress={() => {
                  void handleSaveMeta()
                }}
              >
                {t('common.confirm')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {validation !== null && (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setValidation(null)
          }}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <span>
                {t('fileShare.validation.title', {
                  file: validation.file,
                  status: validation.result.ok
                    ? t('fileShare.validation.added')
                    : t('fileShare.validation.rejected')
                })}
              </span>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-1.5">
                {validation.result.issues.map((issue, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        issue.level === 'fatal'
                          ? 'bg-danger'
                          : issue.level === 'warn'
                            ? 'bg-warning'
                            : 'bg-success'
                      }`}
                    />
                    <span className="break-all">{issue.message}</span>
                  </div>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                color="primary"
                onPress={() => {
                  setValidation(null)
                }}
              >
                {t('common.close')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </BasePage>
  )
}

export default FileShare
