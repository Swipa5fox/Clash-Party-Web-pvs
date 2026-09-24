import { Button } from '@heroui/react'
import { ReactNode } from 'react'
import { ErrorBoundary, FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { copyText } from '@renderer/utils/clipboard'

const ErrorFallback = ({ error }: FallbackProps): React.ReactElement => {
  const { t } = useTranslation()
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? (error.stack ?? '') : ''

  return (
    <div className="p-4">
      <h2 className="my-2 text-lg font-bold">{t('common.error.appCrash')}</h2>

      <Button
        size="sm"
        color="primary"
        variant="flat"
        onPress={() => open('https://github.com/Swipa5fox/Clash-Party-Web-pvs/issues/new/choose')}
      >
        GitHub
      </Button>
      <Button
        size="sm"
        color="primary"
        variant="flat"
        className="ml-2"
        onPress={() => open('https://t.me/mihomo_party_group')}
      >
        Telegram
      </Button>

      <Button
        size="sm"
        variant="flat"
        className="ml-2"
        onPress={() => {
          void copyText('```\n' + errorMessage + '\n' + errorStack + '\n```').catch(() => {})
        }}
      >
        {t('common.error.copyErrorMessage')}
      </Button>

      <p className="my-2 select-text">{errorMessage}</p>

      <details title="Error Stack">
        <summary>Error Stack</summary>
        <pre className="select-text">{errorStack}</pre>
      </details>
    </div>
  )
}

interface Props {
  children?: ReactNode
}

const BaseErrorBoundary = (props: Props): React.ReactElement => {
  return <ErrorBoundary FallbackComponent={ErrorFallback}>{props.children}</ErrorBoundary>
}

export default BaseErrorBoundary
