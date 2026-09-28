import React, { ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import { getControledMihomoConfig, patchControledMihomoConfig as patch } from '@renderer/utils/ipc'
import { createConfigContext } from './create-config-context'

const { Provider, useConfig } = createConfigContext<Partial<IMihomoConfig>>({
  swrKey: 'getControledMihomoConfig',
  fetcher: () => getControledMihomoConfig(),
  ipcEvent: 'controledMihomoConfigUpdated'
})

interface ControledMihomoConfigContextType {
  controledMihomoConfig: Partial<IMihomoConfig> | undefined
  mutateControledMihomoConfig: () => void
  patchControledMihomoConfig: (value: Partial<IMihomoConfig>) => Promise<void>
}

const ControledMihomoConfigContext = React.createContext<
  ControledMihomoConfigContextType | undefined
>(undefined)

export const ControledMihomoConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <Provider>
    <ControledMihomoConfigContextWrapper>{children}</ControledMihomoConfigContextWrapper>
  </Provider>
)

const ControledMihomoConfigContextWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, mutate } = useConfig()
  const { t } = useTranslation()

  const patchControledMihomoConfig = useCallback(
    async (value: Partial<IMihomoConfig>): Promise<void> => {
      try {
        await patch(value)
      } catch (e) {
        showError(e, t('common.error.updateCoreConfigFailed'))
      } finally {
        mutate()
      }
    },
    [mutate, t]
  )

  return (
    <ControledMihomoConfigContext.Provider
      value={{
        controledMihomoConfig: config,
        mutateControledMihomoConfig: mutate,
        patchControledMihomoConfig
      }}
    >
      {children}
    </ControledMihomoConfigContext.Provider>
  )
}

export const useControledMihomoConfig = (): ControledMihomoConfigContextType => {
  const context = React.useContext(ControledMihomoConfigContext)
  if (context === undefined) {
    throw new Error('useControledMihomoConfig must be used within a ControledMihomoConfigProvider')
  }
  return context
}
