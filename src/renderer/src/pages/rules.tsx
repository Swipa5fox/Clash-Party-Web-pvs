import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'
import { getHitDeltas, recordSamples } from '@renderer/components/rules/rule-hit-history'
import { Virtuoso } from 'react-virtuoso'
import { Key, useEffect, useMemo, useState } from 'react'
import { Divider, Input, Tab, Tabs } from '@heroui/react'
import { useRules } from '@renderer/hooks/use-rules'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { mihomoCloseAllConnections } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

const RULES_FILTER_KEY = 'rules-filter'
const RULES_ORDER_BY_KEY = 'rules-order-by'
const RULES_ORDER_DIRECTION_KEY = 'rules-order-direction'

// 命中采样间隔：页面挂载期间轮询 /rules，滚动窗口见 rule-hit-history.ts
const SAMPLE_INTERVAL_MS = 10_000

type RuleOrderBy = 'index' | 'type' | 'payload' | 'proxy' | 'hitCount' | 'hitRate' | 'hitAt'
type SortDirection = 'asc' | 'desc'

// 排序取值：无 extra（非 Smart 内核）的命中类字段按 0 参与排序
const sortValue = (rule: IMihomoRulesDetail, key: RuleOrderBy): string | number => {
  switch (key) {
    case 'type':
      return rule.type
    case 'payload':
      return rule.payload
    case 'proxy':
      return rule.proxy
    case 'hitCount':
      return rule.extra?.hitCount ?? 0
    case 'hitRate': {
      const total = (rule.extra?.hitCount ?? 0) + (rule.extra?.missCount ?? 0)
      return total > 0 ? (rule.extra?.hitCount ?? 0) / total : 0
    }
    case 'hitAt':
      return Date.parse(rule.extra?.hitAt || rule.extra?.missAt || '') || 0
    default:
      return rule.index ?? 0
  }
}

const Rules: React.FC = () => {
  const { rules, mutate } = useRules()
  const { t } = useTranslation()
  const [filter, setFilter] = useState(() => localStorage.getItem(RULES_FILTER_KEY) || '')
  const [orderBy, setOrderBy] = useState<RuleOrderBy>(
    () => (localStorage.getItem(RULES_ORDER_BY_KEY) as RuleOrderBy) || 'index'
  )
  const [direction, setDirection] = useState<SortDirection>(
    () => (localStorage.getItem(RULES_ORDER_DIRECTION_KEY) as SortDirection | null) ?? 'asc'
  )
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

  useEffect(() => {
    localStorage.setItem(RULES_ORDER_BY_KEY, orderBy)
    localStorage.setItem(RULES_ORDER_DIRECTION_KEY, direction)
  }, [orderBy, direction])

  // 命中趋势采样：页面挂载期间定时轮询，rules 变化时记录快照
  useEffect(() => {
    const id = setInterval(() => {
      void mutate()
    }, SAMPLE_INTERVAL_MS)
    return (): void => {
      clearInterval(id)
    }
  }, [mutate])

  useEffect(() => {
    if (rules) recordSamples(rules.rules)
  }, [rules])

  // 按钮与内核 mode 联动(原侧栏三态切换器的两态版,去掉"全局")。
  // 重活全部异步化,不阻塞点击 → 动画全程 60fps:
  //  - patchControledMihomoConfig 内部已做: 写盘 + 内核热更新(patchMihomoConfig)
  //  - mode 切换不改变组成员,mutateGroups 纯属浪费(224 个代理的全量拉取),删掉
  //  - 托盘已随桌面壳移除,不再发送 updateTrayMenu/updateTrayIcon
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
      }
    })()
  }

  // 表头点击排序：同列 asc↔desc 切换，换列沿用当前方向
  const handleSort = (key: RuleOrderBy): void => {
    if (orderBy === key) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setOrderBy(key)
    }
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

  const sortedRules = useMemo(() => {
    const list = [...filteredRules]
    list.sort((a, b) => {
      const va = sortValue(a, orderBy)
      const vb = sortValue(b, orderBy)
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb))
      return direction === 'asc' ? cmp : -cmp
    })
    return list
  }, [filteredRules, orderBy, direction])

  // 表头单元格：列宽与 RuleItem 对齐（w-10 序号 / w-24 类型 / flex-1 内容 / w-28 策略 …）
  const SortHeader = ({
    keyName,
    labelKey,
    className = ''
  }: {
    keyName: RuleOrderBy
    labelKey: string
    className?: string
  }): React.JSX.Element => (
    <button
      type="button"
      onClick={() => handleSort(keyName)}
      className={`shrink-0 text-start cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
    >
      {t(labelKey)}
      {orderBy === keyName ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )

  return (
    <BasePage title={t('rules.title')}>
      <div className="sticky top-0 z-40 bg-background">
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
        <div className="px-2 pb-1">
          <div className="flex items-center gap-3 px-3 text-[10px] font-medium text-foreground-500">
            <SortHeader keyName="index" labelKey="rules.sort.index" className="w-12" />
            <SortHeader keyName="type" labelKey="rules.sort.type" className="w-24" />
            <SortHeader
              keyName="payload"
              labelKey="rules.sort.payload"
              className="flex-1 min-w-0"
            />
            <SortHeader keyName="proxy" labelKey="rules.sort.proxy" className="w-28" />
            <SortHeader
              keyName="hitCount"
              labelKey="rules.sort.hitCount"
              className="w-14 text-right"
            />
            <SortHeader
              keyName="hitRate"
              labelKey="rules.sort.hitRate"
              className="w-14 text-right"
            />
            <SortHeader keyName="hitAt" labelKey="rules.sort.hitAt" className="w-12 text-right" />
            <span className="w-[80px] shrink-0" aria-hidden="true" />
            <span className="w-8 shrink-0" aria-hidden="true" />
          </div>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-176px)] mt-px">
        <Virtuoso
          data={sortedRules}
          itemContent={(i, rule) => (
            <RuleItem
              index={rule.index ?? i}
              type={rule.type}
              payload={rule.payload}
              proxy={rule.proxy}
              size={rule.size}
              extra={rule.extra}
              sparkline={getHitDeltas(rule.index ?? i)}
            />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Rules
