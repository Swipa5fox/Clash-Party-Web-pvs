import React, { useEffect, useRef, useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, Select, SelectItem, Switch, Tab, Tabs } from '@heroui/react'
import { BiCopy, BiSolidFileImport } from 'react-icons/bi'
import {
  applyTheme,
  copyEnvText,
  fetchThemes,
  importThemesFromContents,
  resolveThemes,
  writeTheme
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { copyText } from '@renderer/utils/clipboard'
import { platform } from '@renderer/utils/init'
import { useTheme } from 'next-themes'
import { IoMdCloudDownload } from 'react-icons/io'
import { MdEditDocument } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import CSSEditorModal from './css-editor-modal'

const GeneralConfig: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const [customThemes, setCustomThemes] = useState<{ key: string; label: string }[]>()
  const [openCSSEditor, setOpenCSSEditor] = useState(false)
  const [fetching, setFetching] = useState(false)
  const { setTheme } = useTheme()
  const {
    rememberSelectedSiderCard = false,
    lockSiderCards = false,
    disableAnimations = false,
    customTheme = 'default.css',
    envType = [platform === 'win32' ? 'powershell' : 'bash'],
    autoCheckUpdate = true,
    autoUpdateProfileOnStart = true,
    silentUpdate = true,
    githubProxy = 'auto',
    appTheme = 'system',
    language = 'zh-CN',
    hideConnectionCardWave = false,
    disableAppLog = false
  } = appConfig || {}

  useEffect(() => {
    resolveThemes().then((themes) => {
      setCustomThemes(themes)
    })
  }, [])

  const themeImportInputRef = useRef<HTMLInputElement>(null)

  // web 端主题导入：浏览器 <input type="file"> 直读内容，经 importThemesFromContents 内容直传
  const importThemesFromInput = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    try {
      const contents = await Promise.all(
        Array.from(files).map(async (file) => ({ name: file.name, content: await file.text() }))
      )
      const count = await importThemesFromContents(contents)
      setCustomThemes(await resolveThemes())
      toast.success(`成功导入 ${count} 个主题`)
    } catch (e) {
      toast.error(String(e))
    }
  }

  return (
    <>
      <input
        ref={themeImportInputRef}
        type="file"
        accept=".css"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          e.target.value = ''
          void importThemesFromInput(files)
        }}
      />
      {openCSSEditor && (
        <CSSEditorModal
          theme={customTheme}
          onCancel={() => setOpenCSSEditor(false)}
          onConfirm={async (css: string) => {
            await writeTheme(customTheme, css)
            await applyTheme(customTheme)
            setOpenCSSEditor(false)
          }}
        />
      )}
      <SettingCard>
        <SettingItem title={t('settings.language')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-37.5"
            size="sm"
            selectedKeys={[language]}
            aria-label={t('settings.language')}
            onSelectionChange={async (v) => {
              const newLang = Array.from(v)[0] as 'zh-CN' | 'en-US'
              await patchAppConfig({ language: newLang })
              i18n.changeLanguage(newLang)
            }}
          >
            <SelectItem key="en-US">English</SelectItem>
            <SelectItem key="zh-CN">简体中文</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('settings.autoUpdateProfileOnStart')} divider>
          <Switch
            size="sm"
            isSelected={autoUpdateProfileOnStart}
            onValueChange={(v) => {
              patchAppConfig({ autoUpdateProfileOnStart: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.autoCheckUpdate')} divider>
          <Switch
            size="sm"
            isSelected={autoCheckUpdate}
            onValueChange={(v) => {
              patchAppConfig({ autoCheckUpdate: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.silentUpdate')} divider>
          <Switch
            size="sm"
            isSelected={silentUpdate}
            onValueChange={(v) => {
              patchAppConfig({ silentUpdate: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.githubProxy')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-50"
            size="sm"
            selectedKeys={[githubProxy]}
            aria-label={t('settings.githubProxy')}
            onSelectionChange={(v) => {
              patchAppConfig({ githubProxy: Array.from(v)[0] as string })
            }}
          >
            <SelectItem key="auto">{t('settings.githubProxy.auto')}</SelectItem>
            <SelectItem key="direct">{t('settings.githubProxy.direct')}</SelectItem>
            <SelectItem key="https://gh-proxy.org">gh-proxy.org</SelectItem>
            <SelectItem key="https://ghfast.top">ghfast.top</SelectItem>
            <SelectItem key="https://down.clashparty.org">down.clashparty.org</SelectItem>
            <SelectItem key="https://download.mihomo.party">download.mihomo.party</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem
          title={t('settings.envType')}
          actions={envType.map((type) => (
            <Button
              key={type}
              title={type}
              isIconOnly
              size="sm"
              variant="light"
              onPress={async () => {
                // copyEnv 通道已随桌面壳移除，统一经 copyEnvText 取回文本，由前端写入浏览器剪贴板
                try {
                  const text = await copyEnvText(type)
                  await copyText(text)
                  toast.success(t('common.copied'))
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            >
              <BiCopy className="text-lg" />
            </Button>
          ))}
          divider
        >
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-37.5"
            size="sm"
            selectionMode="multiple"
            selectedKeys={new Set(envType)}
            aria-label={t('settings.envType')}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  envType: Array.from(v) as ('bash' | 'cmd' | 'powershell' | 'fish' | 'nushell')[]
                })
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            <SelectItem key="bash">Bash</SelectItem>
            <SelectItem key="cmd">CMD</SelectItem>
            <SelectItem key="powershell">PowerShell</SelectItem>
            <SelectItem key="fish">Fish</SelectItem>
            <SelectItem key="nushell">Nushell</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('settings.rememberSelectedSiderCard')} divider>
          <Switch
            size="sm"
            isSelected={rememberSelectedSiderCard}
            onValueChange={async (v) => {
              await patchAppConfig({ rememberSelectedSiderCard: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.lockSiderCards')} divider>
          <Switch
            size="sm"
            isSelected={lockSiderCards}
            onValueChange={async (v) => {
              await patchAppConfig({ lockSiderCards: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.disableAnimations')} divider>
          <Switch
            size="sm"
            isSelected={disableAnimations}
            onValueChange={async (v) => {
              await patchAppConfig({ disableAnimations: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.disableAppLog')} divider>
          <Switch
            size="sm"
            isSelected={disableAppLog}
            onValueChange={async (v) => {
              await patchAppConfig({ disableAppLog: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.hideConnectionCardWave')} divider>
          <Switch
            size="sm"
            isSelected={hideConnectionCardWave}
            onValueChange={async (v) => {
              await patchAppConfig({ hideConnectionCardWave: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.backgroundColor')} divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={appTheme}
            onSelectionChange={(key) => {
              setTheme(key.toString())
              patchAppConfig({ appTheme: key as AppTheme })
            }}
          >
            <Tab key="system" title={t('settings.backgroundAuto')} />
            <Tab key="dark" title={t('settings.backgroundDark')} />
            <Tab key="light" title={t('settings.backgroundLight')} />
          </Tabs>
        </SettingItem>
        <SettingItem
          title={t('settings.theme')}
          actions={
            <>
              <Button
                size="sm"
                isLoading={fetching}
                isIconOnly
                title={t('settings.fetchTheme')}
                variant="light"
                onPress={async () => {
                  setFetching(true)
                  try {
                    await fetchThemes()
                    setCustomThemes(await resolveThemes())
                  } catch (e) {
                    toast.error(String(e))
                  } finally {
                    setFetching(false)
                  }
                }}
              >
                <IoMdCloudDownload className="text-lg" />
              </Button>
              <Button
                size="sm"
                isIconOnly
                title={t('settings.importTheme')}
                variant="light"
                onPress={async () => {
                  // web 模式统一走浏览器文件选择 + 内容直传
                  themeImportInputRef.current?.click()
                }}
              >
                <BiSolidFileImport className="text-lg" />
              </Button>
              <Button
                size="sm"
                isIconOnly
                title={t('settings.editTheme')}
                variant="light"
                onPress={async () => {
                  setOpenCSSEditor(true)
                }}
              >
                <MdEditDocument className="text-lg" />
              </Button>
            </>
          }
        >
          {customThemes && (
            <Select
              classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
              className="w-[60%]"
              size="sm"
              selectedKeys={new Set([customTheme])}
              aria-label={t('settings.selectTheme')}
              disallowEmptySelection={true}
              onSelectionChange={async (v) => {
                try {
                  await patchAppConfig({ customTheme: v.currentKey as string })
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            >
              {customThemes.map((theme) => (
                <SelectItem key={theme.key}>{theme.label}</SelectItem>
              ))}
            </Select>
          )}
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default GeneralConfig
