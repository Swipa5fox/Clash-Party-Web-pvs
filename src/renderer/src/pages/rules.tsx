import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'
import { Virtuoso } from 'react-virtuoso'
import { Key, useEffect, useMemo, useState } from 'react'
import { Divider, Input, Tab, Tabs } from '@heroui/react'
import { useRules } from '@renderer/hooks/use-rules'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { mihomoCloseAllConnections, updateTrayIcon } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

const RULES_FILTER_KEY = 'rules-filter'

const Rules: React.FC = () => {
  const { rules } = useRules()
  const { t } = useTranslation()
  const [filter, setFilter] = useState(() => localStorage.getItem(RULES_FILTER_KEY) || '')
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}
  const { mode } = controledMihomoConfig || {}

  // 乐观视图:点击瞬间先切 UI,内核 mode 由后台链路确认(patch 内部已含内核热更新,
  // 无需再调 patchMihomoConfig —— 之前调过两次,是点击卡顿的主因之一)。
  // 非空时优先于服务器值;后台完成后清空,交给 SWR 的真实 mode 接管。
  // 万一 patch 失败,SWR 重取(在 patch 的 finally 里)会把真实 mode 带回来,视图自动纠正。
  const [optimisticView, setOptimisticView] = useState<'rule' | 'direct' | null>(null)
  const serverView: 'rule' | 'direct' = mode === 'direct' ? 'direct' : 'rule'
  const view = optimisticView ?? serverView

  useEffect(() => {
    localStorage.setItem(RULES_FILTER_KEY, filter)
  }, [filter])

  // 按钮与内核 mode 联动(原侧栏三态切换器的两态版,去掉"全局")。
  // 重活全部异步化,不阻塞点击 → 动画全程 60fps:
  //  - patchControledMihomoConfig 内部已做: 写盘 + 内核热更新(patchMihomoConfig)
  //  - mode 切换不改变组成员,mutateGroups 纯属浪费(224 个代理的全量拉取),删掉
  //  - updateTrayMenu/updateTrayIcon 是托盘的事,web 模式下无托盘,发事件不等待
  const onChangeMode = (key: Key): void => {
    // 只有两个 tab,非 direct 即 rule(global 历史值也归到 rule 展示)
    const next: 'rule' | 'direct' = key === 'direct' ? 'direct' : 'rule'
    if (next === view) return
    setOptimisticView(next)

    void (async (): Promise<void> => {
      try {
        await patchControledMihomoConfig({ mode: next })
        if (autoCloseConnection) {
          mihomoCloseAllConnections().catch(() => {})
        }
      } catch {
        // 失败不回滚 UI —— SWR 的 mutate(在 patch 的 finally 里)会把真实 mode 带回
      } finally {
        setOptimisticView(null)
        window.electron.ipcRenderer.send('updateTrayMenu')
        updateTrayIcon().catch(() => {})
      }
    })()
  }

  // 二次过滤:支持多个条件(逗号/中文逗号/空格/换行分隔),任一命中即可 ——
  // 可直接把 Proxy SwitchyOmega 各配置文件里的条件列表粘进来比对。
  // 条件里形如 *.example.com 的前缀通配,去掉 * 后按子串匹配(和分流规则的 payload 对得上)。
  const patterns = useMemo(
    () =>
      filter
        .split(/[,，\s]+/)
        .map((p) => p.trim().replace(/^\*+\.?/, ''))
        .filter((p) => p.length > 0),
    [filter]
  )

  const filteredRules = useMemo(() => {
    if (!rules) return []
    return rules.rules.filter((rule) => {
      const isDirect = String(rule.proxy).toUpperCase() === 'DIRECT'
      if (view === 'direct' ? !isDirect : isDirect) return false
      if (patterns.length === 0) return true
      return patterns.some(
        (p) =>
          includesIgnoreCase(rule.payload, p) ||
          includesIgnoreCase(rule.type, p) ||
          includesIgnoreCase(rule.proxy, p)
      )
    })
  }, [rules, patterns, view])

  return (
    <BasePage title={t('rules.title')}>
      <div className="sticky top-0 z-40">
        <div className="flex justify-center px-2 pt-2">
          <Tabs
            color="primary"
            selectedKey={view}
            classNames={{ tabList: 'bg-content1 shadow-medium' }}
            onSelectionChange={onChangeMode}
            destroyInactiveTabPanel={false}
          >
            <Tab
              className={`${view === 'rule' ? 'font-bold' : ''}`}
              key="rule"
              title={t('sider.cards.outbound.rule')}
            />
            <Tab
              className={`${view === 'direct' ? 'font-bold' : ''}`}
              key="direct"
              title={t('sider.cards.outbound.direct')}
            />
          </Tabs>
        </div>
        <div className="flex items-center gap-2 p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('rules.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <span className="text-xs text-default-500 shrink-0 whitespace-nowrap">
            {filteredRules.length}/{rules?.rules.length ?? 0}
          </span>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-150px)] mt-px">
        <Virtuoso
          data={filteredRules}
          itemContent={(i, rule) => (
            <RuleItem
              index={rule.index ?? i}
              type={rule.type}
              payload={rule.payload}
              proxy={rule.proxy}
              size={rule.size}
              extra={rule.extra}
            />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Rules
