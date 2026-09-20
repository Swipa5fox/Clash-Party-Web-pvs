import React, { ReactNode } from 'react'
import { getPluginConfig } from '@renderer/utils/ipc'
import { createConfigContext } from './create-config-context'

const { Provider, useConfig } = createConfigContext<IPluginConfig>({
  swrKey: 'getPluginConfig',
  fetcher: getPluginConfig,
  ipcEvent: 'pluginConfigUpdated'
})

export const PluginConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <Provider>{children}</Provider>
)

export const usePluginConfig = (): {
  pluginConfig: IPluginConfig | undefined
  mutatePluginConfig: () => void
} => {
  const { config, mutate } = useConfig()
  return { pluginConfig: config, mutatePluginConfig: mutate }
}
