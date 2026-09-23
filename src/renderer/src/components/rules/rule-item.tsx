import { Chip, Switch } from '@heroui/react'
import React, { useState, useEffect } from 'react'
import { mihomoRulesDisable } from '@renderer/utils/ipc'
import RuleSparkline from './rule-sparkline'

interface RuleItemProps extends IMihomoRulesDetail {
  index: number
  sparkline?: number[]
}

// 紧凑单行展示：列宽与 rules.tsx 表头保持一致
const RuleItem: React.FC<RuleItemProps> = (props) => {
  const { type, payload, proxy, index: listIndex, extra, sparkline } = props
  const ruleIndex = props.index ?? listIndex

  const [isEnabled, setIsEnabled] = useState(!extra?.disabled)

  useEffect(() => {
    setIsEnabled(!extra?.disabled)
  }, [extra?.disabled])

  const handleToggle = async (v: boolean): Promise<void> => {
    setIsEnabled(v)
    try {
      await mihomoRulesDisable({ [ruleIndex]: !v })
    } catch (error) {
      console.error('Failed to toggle rule:', error)
      setIsEnabled(!v)
    }
  }

  // 紧凑相对时间（语言无关单位）：3s / 5m / 2h / 4d，未命中显示 —
  const formatCompactTime = (timestamp: string): string => {
    const time = new Date(timestamp).getTime()
    if (!time) return '—'
    const diff = Math.floor((Date.now() - time) / 1000)
    if (diff < 60) return `${Math.max(diff, 0)}s`
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    return `${Math.floor(diff / 86400)}d`
  }

  const total = extra ? extra.hitCount + extra.missCount : 0
  const rate = total > 0 ? (extra ? (extra.hitCount / total) * 100 : 0) : 0

  return (
    <div className={`w-full px-2 pb-1 ${listIndex === 0 ? 'pt-1' : ''}`}>
      <div
        className={`flex items-center gap-3 h-9 px-3 rounded-medium hover:bg-default-100 transition-colors text-xs ${
          !isEnabled ? 'opacity-50' : ''
        }`}
      >
        <span className="w-12 shrink-0 text-foreground-400 tabular-nums">{ruleIndex}</span>
        <Chip
          size="sm"
          radius="sm"
          variant="bordered"
          className="text-[10px] h-5 shrink-0 w-24 justify-center overflow-hidden"
        >
          <span className="truncate">{type}</span>
        </Chip>
        <span title={payload} className="flex-1 min-w-0 truncate font-medium">
          {payload}
        </span>
        <span title={proxy} className="w-28 shrink-0 truncate text-foreground-600">
          {proxy}
        </span>
        <span className="w-14 shrink-0 text-right tabular-nums font-medium">
          {extra ? extra.hitCount : '—'}
        </span>
        <span className="w-14 shrink-0 text-right tabular-nums text-primary">
          {extra && total > 0 ? `${rate.toFixed(1)}%` : '—'}
        </span>
        <span
          className="w-12 shrink-0 text-right tabular-nums text-foreground-500"
          title={extra ? formatCompactTime(extra.hitAt || extra.missAt) : undefined}
        >
          {extra ? formatCompactTime(extra.hitAt || extra.missAt) : '—'}
        </span>
        <span className="shrink-0 text-foreground-400">
          <RuleSparkline values={sparkline ?? []} />
        </span>
        <Switch
          size="sm"
          isSelected={isEnabled}
          onValueChange={handleToggle}
          aria-label="Toggle rule"
          classNames={{ wrapper: 'h-4 w-8', thumb: 'h-3 w-3 group-data-[selected=true]:ms-4' }}
        />
      </div>
    </div>
  )
}

export default RuleItem
