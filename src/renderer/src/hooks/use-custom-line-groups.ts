import useSWR, { useSWRConfig } from 'swr'
import { getCustomLineGroupsConfig, setCustomLineGroupsConfig } from '@renderer/utils/ipc'
import { toast } from '@renderer/components/base/toast'
import { useTranslation } from 'react-i18next'

// 自定义线路组状态管理: SWR 拉取 + 保存后刷新代理组
export const useCustomLineGroups = (): {
  groups: ICustomLineGroup[] | undefined
  saveGroups: (groups: ICustomLineGroup[]) => Promise<boolean>
} => {
  const { t } = useTranslation()
  const { data, mutate } = useSWR<ICustomLineGroupsConfig>('getCustomLineGroupsConfig', () =>
    getCustomLineGroupsConfig()
  )
  const { mutate: globalMutate } = useSWRConfig()

  const saveGroups = async (next: ICustomLineGroup[]): Promise<boolean> => {
    try {
      await setCustomLineGroupsConfig({ items: next })
      await mutate()
      // 保存成功后通知代理组列表刷新(groupsUpdated 事件由主进程广播)
      void globalMutate((key: unknown) => Array.isArray(key) && key[0] === 'mihomoGroups')
      return true
    } catch (e) {
      toast.error(t('customLines.saveFailed', { error: String(e) }))
      return false
    }
  }

  return {
    groups: data?.items,
    saveGroups
  }
}
