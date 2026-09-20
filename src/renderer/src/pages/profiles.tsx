import {
  Button,
  Checkbox,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Tooltip
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { toast } from '@renderer/components/base/toast'
import ProfileItem from '@renderer/components/profiles/profile-item'
import PluginItem from '@renderer/components/plugins/plugin-item'
import PluginInstallModal from '@renderer/components/plugins/plugin-install-modal'
import EditInfoModal from '@renderer/components/profiles/edit-info-modal'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { usePluginConfig } from '@renderer/hooks/use-plugin-config'
import { updatePluginProfile } from '@renderer/utils/ipc'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdContentPaste, MdUnfoldMore, MdUnfoldLess } from 'react-icons/md'
import { TbPuzzle } from 'react-icons/tb'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { FaPlus } from 'react-icons/fa6'
import { IoMdRefresh } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import { subscribePluginFile, takePendingPluginFile } from '@renderer/utils/plugin-file-open'

const Profiles: React.FC = () => {
  const { t } = useTranslation()
  const {
    profileConfig,
    setProfileConfig,
    addProfileItem,
    updateProfileItem,
    removeProfileItem,
    changeCurrentProfile,
    mutateProfileConfig
  } = useProfileConfig()
  const { current, items = [] } = profileConfig || {}
  const [sortedItems, setSortedItems] = useState(items)
  const [useProxy, setUseProxy] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [userAgent, setUserAgent] = useState('')
  const [ageSecretKey, setAgeSecretKey] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [openInfoImport, setOpenInfoImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [url, setUrl] = useState('')
  const [, setNow] = useState(new Date())
  const { pluginConfig, mutatePluginConfig } = usePluginConfig()
  const [showPluginImport, setShowPluginImport] = useState(false)
  const [pluginDropFile, setPluginDropFile] = useState<File | null>(null)
  const [pluginFileData, setPluginFileData] = useState<IPluginFilePayload | null>(null)
  // bump per .cpx drop -> remount modal so it loads the new file even when open
  const [pluginDropSeq, setPluginDropSeq] = useState(0)
  const isUrlEmpty = url.trim() === ''
  const sensors = useSensors(useSensor(PointerSensor))
  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      await addProfileItem({
        name: '',
        type: 'remote',
        url,
        useProxy,
        authToken: authToken || undefined,
        userAgent: userAgent || undefined,
        ageSecretKey: ageSecretKey || undefined
      })
      // 只在成功后清空输入框: 失败时保留原 URL 方便用户改
      setUrl('')
      setAuthToken('')
      setUserAgent('')
      setAgeSecretKey('')
    } catch (e) {
      // 导入失败必须报出来(如订阅链接 403), 否则用户只能看到"加不进去"而不知原因
      toast.error(String(e))
    } finally {
      setImporting(false)
    }
  }
  const pageRef = useRef<HTMLDivElement>(null)

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    if (over) {
      if (active.id !== over.id) {
        const newOrder = sortedItems.slice()
        const activeIndex = newOrder.findIndex((item) => item.id === active.id)
        const overIndex = newOrder.findIndex((item) => item.id === over.id)
        const [movedItem] = newOrder.splice(activeIndex, 1)
        newOrder.splice(overIndex, 0, movedItem)
        setSortedItems(newOrder)
        await setProfileConfig({ current, items: newOrder })
      }
    }
  }

  const handleImportRef = useRef(handleImport)
  handleImportRef.current = handleImport

  const addProfileItemRef = useRef(addProfileItem)
  addProfileItemRef.current = addProfileItem

  const tRef = useRef(t)
  tRef.current = t

  // 打开文件：浏览器/桌面统一走隐藏 input 直读文件内容，不经 getFilePath/readTextFile 主进程链
  const openFileInputRef = useRef<HTMLInputElement>(null)

  const openLocalProfile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const content = await file.text()
      await addProfileItemRef.current({ name: file.name, type: 'local', file: content })
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.currentTarget.value.trim() === '') return
    handleImportRef.current()
  }, [])

  const openPendingPluginFile = useCallback((): void => {
    const payload = takePendingPluginFile()
    if (!payload) return
    setPluginDropFile(null)
    setPluginFileData(payload)
    setPluginDropSeq((n) => n + 1)
    setShowPluginImport(true)
  }, [])

  useEffect(() => {
    openPendingPluginFile()
    return subscribePluginFile(openPendingPluginFile)
  }, [openPendingPluginFile])

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

    const handleDrop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer?.files) {
        const file = event.dataTransfer.files[0]
        const name = file?.name.toLowerCase() ?? ''
        if (name.endsWith('.yml') || name.endsWith('.yaml')) {
          try {
            // 浏览器/桌面统一直读文件内容，不经 webUtils.getPathForFile/readTextFile 走主进程路径
            const content = await file.text()
            await addProfileItemRef.current({ name: file.name, type: 'local', file: content })
          } catch (e) {
            toast.error(String(e))
          }
        } else if (name.endsWith('.cpx')) {
          // .cpx -> plugin install modal (preview + confirm)
          setPluginFileData(null)
          setPluginDropFile(file)
          setPluginDropSeq((n) => n + 1)
          setShowPluginImport(true)
        } else if (file) {
          toast.warning(tRef.current('profiles.error.unsupportedFileType'))
        }
      }
      setFileOver(false)
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

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setSortedItems(items)
  }, [items])

  return (
    <BasePage
      ref={pageRef}
      title={t('profiles.title')}
      header={
        <>
          <Button
            size="sm"
            title={t('plugins.title')}
            isIconOnly
            variant="light"
            className="app-nodrag"
            onPress={() => {
              setPluginDropFile(null)
              setPluginFileData(null)
              setShowPluginImport(true)
            }}
          >
            <TbPuzzle className="text-lg" />
          </Button>
          <Button
            size="sm"
            title={t('profiles.updateAll')}
            className="app-nodrag"
            variant="light"
            isIconOnly
            onPress={async () => {
              setUpdating(true)
              try {
                for (const item of items) {
                  if (item.id === current) continue
                  if (item.type === 'remote') await addProfileItem(item)
                  else if (item.type === 'plugin' && item.pluginId)
                    await updatePluginProfile(item.pluginId, true)
                }
                const currentItem = items.find((item) => item.id === current)
                if (currentItem && currentItem.type === 'remote') {
                  await addProfileItem(currentItem)
                } else if (currentItem?.type === 'plugin' && currentItem.pluginId) {
                  await updatePluginProfile(currentItem.pluginId, true)
                }
              } catch (e) {
                toast.error(String(e))
              } finally {
                setUpdating(false)
              }
            }}
          >
            <IoMdRefresh className={`text-lg ${updating ? 'animate-spin' : ''}`} />
          </Button>
        </>
      }
    >
      <input
        ref={openFileInputRef}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void openLocalProfile(file)
        }}
      />
      {openInfoImport && (
        <EditInfoModal
          mode="import"
          item={{
            id: '',
            name: '',
            type: 'remote',
            url: '',
            override: [],
            useProxy
          }}
          addProfileItem={addProfileItem}
          onClose={() => setOpenInfoImport(false)}
        />
      )}
      <div className="sticky profiles-sticky top-0 z-40 bg-background">
        <div className="flex flex-col gap-2 p-2">
          <div className="flex gap-2">
            <Input
              size="sm"
              placeholder={t('profiles.input.placeholder')}
              value={url}
              onValueChange={setUrl}
              onKeyUp={handleInputKeyUp}
              className="flex-1"
              endContent={
                <>
                  <Button
                    size="md"
                    isIconOnly
                    variant="light"
                    onPress={() => {
                      navigator.clipboard.readText().then((text) => {
                        setUrl(text)
                      })
                    }}
                    className="mr-2"
                  >
                    <MdContentPaste className="text-lg" />
                  </Button>
                  <Checkbox
                    className="whitespace-nowrap"
                    checked={useProxy}
                    onValueChange={setUseProxy}
                  >
                    {t('profiles.useProxy')}
                  </Checkbox>
                </>
              }
            />

            <Tooltip content={t('profiles.editInfo.authToken')} placement="bottom">
              <Button
                size="sm"
                variant={showAdvanced ? 'solid' : 'light'}
                isIconOnly
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? (
                  <MdUnfoldLess className="text-lg" />
                ) : (
                  <MdUnfoldMore className="text-lg" />
                )}
              </Button>
            </Tooltip>
            <Button
              size="sm"
              color="primary"
              isDisabled={isUrlEmpty}
              isLoading={importing}
              onPress={handleImport}
            >
              {t('profiles.import')}
            </Button>
            <Dropdown>
              <DropdownTrigger>
                <Button className="new-profile" size="sm" isIconOnly color="primary">
                  <FaPlus />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                onAction={async (key) => {
                  if (key === 'open') {
                    openFileInputRef.current?.click()
                  } else if (key === 'new') {
                    await addProfileItem({
                      name: t('profiles.newProfile'),
                      type: 'local',
                      file: 'proxies: []\nproxy-groups: []\nrules: []'
                    })
                  } else if (key === 'import') {
                    setOpenInfoImport(true)
                  }
                }}
              >
                <DropdownItem key="import">{t('profiles.import')}</DropdownItem>
                <DropdownItem key="open">{t('profiles.open')}</DropdownItem>
                <DropdownItem key="new">{t('profiles.new')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
          {showAdvanced && (
            <div className="flex gap-2">
              <Input
                size="sm"
                type="password"
                placeholder={t('profiles.editInfo.authTokenPlaceholder')}
                value={authToken}
                onValueChange={setAuthToken}
                onKeyUp={handleInputKeyUp}
                className="flex-1"
              />
              <Input
                size="sm"
                placeholder={t('profiles.editInfo.userAgentPlaceholder')}
                value={userAgent}
                onValueChange={setUserAgent}
                onKeyUp={handleInputKeyUp}
                className="flex-1"
              />
              <Input
                size="sm"
                type="password"
                placeholder={t('profiles.editInfo.ageSecretKeyPlaceholder')}
                value={ageSecretKey}
                onValueChange={setAgeSecretKey}
                onKeyUp={handleInputKeyUp}
                className="flex-1"
              />
            </div>
          )}
        </div>
        <Divider />
      </div>

      {showPluginImport && (
        <PluginInstallModal
          key={pluginDropSeq}
          initialFile={pluginDropFile ?? undefined}
          initialData={pluginFileData ?? undefined}
          onClose={() => {
            setShowPluginImport(false)
            setPluginDropFile(null)
            setPluginFileData(null)
            mutatePluginConfig()
          }}
        />
      )}
      {(pluginConfig?.items?.length ?? 0) > 0 && (
        <div className="px-2 mt-2 mb-3 grid grid-cols-1 gap-2">
          {pluginConfig?.items?.map((p) => (
            <PluginItem key={p.id} item={p} onChanged={mutatePluginConfig} />
          ))}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div
          className={`${fileOver ? 'blur-sm' : ''} grid sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 m-2`}
        >
          <SortableContext
            items={sortedItems.map((item) => {
              return item.id
            })}
          >
            {sortedItems.map((item) => (
              <ProfileItem
                key={item.id}
                isCurrent={item.id === current}
                addProfileItem={addProfileItem}
                removeProfileItem={removeProfileItem}
                mutateProfileConfig={mutateProfileConfig}
                updateProfileItem={updateProfileItem}
                info={item}
                onPress={async () => {
                  await changeCurrentProfile(item.id)
                }}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </BasePage>
  )
}

export default Profiles
