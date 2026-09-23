import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { HeroUIProvider } from '@heroui/react'
import { init } from '@renderer/utils/init'
import '@renderer/assets/main.css'
import 'flag-icons/css/flag-icons.min.css'
import App from '@renderer/App'
import BaseErrorBoundary from './components/base/base-error-boundary'
import { AppConfigProvider } from './hooks/use-app-config'
import { ControledMihomoConfigProvider } from './hooks/use-controled-mihomo-config'
import { OverrideConfigProvider } from './hooks/use-override-config'
import { ProfileConfigProvider } from './hooks/use-profile-config'
import { PluginConfigProvider } from './hooks/use-plugin-config'
import { RulesProvider } from './hooks/use-rules'
import { GroupsProvider } from './hooks/use-groups'
import { ToastProvider } from './components/base/toast'
import './i18n'

init().then(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <HeroUIProvider>
        <NextThemesProvider attribute="class" enableSystem defaultTheme="dark">
          <BaseErrorBoundary>
            <HashRouter>
              <AppConfigProvider>
                <ControledMihomoConfigProvider>
                  <ProfileConfigProvider>
                    <PluginConfigProvider>
                      <OverrideConfigProvider>
                        <GroupsProvider>
                          <RulesProvider>
                            <ToastProvider>
                              <App />
                            </ToastProvider>
                          </RulesProvider>
                        </GroupsProvider>
                      </OverrideConfigProvider>
                    </PluginConfigProvider>
                  </ProfileConfigProvider>
                </ControledMihomoConfigProvider>
              </AppConfigProvider>
            </HashRouter>
          </BaseErrorBoundary>
        </NextThemesProvider>
      </HeroUIProvider>
    </React.StrictMode>
  )
})
