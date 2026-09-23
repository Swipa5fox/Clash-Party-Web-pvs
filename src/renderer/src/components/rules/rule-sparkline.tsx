import React from 'react'

interface RuleSparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
}

// 行内命中趋势 sparkline：纯 SVG 实现，无图表库依赖，
// 适配虚拟滚动下行的频繁挂载/卸载。
const RuleSparkline: React.FC<RuleSparklineProps> = ({
  values,
  width = 80,
  height = 20,
  className
}) => {
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const hasData = values.length >= 2
  const max = hasData ? Math.max(...values, 1) : 1

  const points = hasData
    ? values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * w
        const y = pad + h - (v / max) * h
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
    : []

  const linePoints = hasData
    ? points.join(' ')
    : `${pad},${height - pad} ${width - pad},${height - pad}`
  const areaPoints = hasData
    ? `${pad},${height - pad} ${points.join(' ')} ${width - pad},${height - pad}`
    : ''

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      {hasData && <polygon points={areaPoints} fill="rgba(34,197,94,0.15)" />}
      <polyline
        points={linePoints}
        fill="none"
        stroke={hasData ? 'rgb(34,197,94)' : 'currentColor'}
        strokeOpacity={hasData ? 1 : 0.3}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default RuleSparkline
