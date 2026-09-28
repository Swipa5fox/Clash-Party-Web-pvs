import React from 'react'

interface Props {
  count: number
  active?: boolean
}

// sider 卡片右上角的数量徽章: 柔和底色 + 等宽数字, 选中卡片时反白
const CountBadge: React.FC<Props> = ({ count, active = false }) => (
  <span
    className={`mr-2 mt-2 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums leading-none ${
      active
        ? 'bg-primary-foreground/20 text-primary-foreground'
        : 'bg-foreground/10 text-foreground-500'
    }`}
  >
    {count}
  </span>
)

export default CountBadge
