import { Button } from '@heroui/react'
import { version } from '@renderer/utils/init'
import { getDriver } from '@renderer/App'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'

const Actions: React.FC = () => {
  const { t } = useTranslation()

  return (
    <SettingCard>
      <SettingItem title={t('actions.guide.title')} divider>
        <Button size="sm" onPress={() => getDriver()?.drive()}>
          {t('actions.guide.button')}
        </Button>
      </SettingItem>
      <SettingItem title={t('actions.version.title')}>
        <div>v{version}</div>
      </SettingItem>
    </SettingCard>
  )
}

export default Actions
