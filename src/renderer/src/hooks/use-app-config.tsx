import React, { ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import { getAppConfig, patchAppConfig as patch } from '@renderer/utils/ipc'
import { createConfigContext } from './create-config-context'

const { Provider, useConfig } = createConfigContext<IAppConfig>({
  swrKey: 'getAppConfig',
  fetcher: getAppConfig,
  ipcEvent: 'appConfigUpdated'
})

interface AppConfigContextType {
  appConfig: IAppConfig | undefined
  mutateAppConfig: () => void
  patchAppConfig: (value: Partial<IAppConfig>) => Promise<void>
}

export const AppConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <Provider>
      <AppConfigContextWrapper>{children}</AppConfigContextWrapper>
    </Provider>
  )
}

const AppConfigContextWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, mutate } = useConfig()
  const { t } = useTranslation()

  const patchAppConfig = useCallback(
    async (value: Partial<IAppConfig>): Promise<void> => {
      try {
        await patch(value)
      } catch (e) {
        await showError(e, t('common.error.updateAppConfigFailed'))
      } finally {
        mutate()
      }
    },
    [mutate, t]
  )

  return (
    <AppConfigContext.Provider
      value={{ appConfig: config, mutateAppConfig: mutate, patchAppConfig }}
    >
      {children}
    </AppConfigContext.Provider>
  )
}

const AppConfigContext = React.createContext<AppConfigContextType | undefined>(undefined)

export const useAppConfig = (): AppConfigContextType => {
  const context = React.useContext(AppConfigContext)
  if (!context) {
    throw new Error('useAppConfig must be used within an AppConfigProvider')
  }
  return context
}
