import { version } from '@renderer/utils/init'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'

const Actions: React.FC = () => {
  const { t } = useTranslation()

  return (
    <SettingCard>
      <SettingItem title={t('actions.version.title')}>
        <div>v{version}</div>
      </SettingItem>
    </SettingCard>
  )
}

export default Actions
