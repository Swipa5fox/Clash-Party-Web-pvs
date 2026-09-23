// 规则命中历史采样器：内核 /rules 只返回累计 hitCount 快照，
// 这里在规则页轮询时按 ruleIndex 记录滚动窗口采样，供行内 sparkline 展示增量趋势。
// 模块级纯内存：页面卸载数据保留，刷新页面即清空。

const MAX_SAMPLES = 60 // 60 点 × 10s 采样间隔 = 10 分钟滚动窗口

const history = new Map<number, number[]>()

export function recordSamples(rules: IMihomoRulesDetail[]): void {
  for (const rule of rules) {
    if (rule.index === undefined) continue
    const samples = history.get(rule.index) ?? []
    samples.push(rule.extra?.hitCount ?? 0)
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
    history.set(rule.index, samples)
  }
}

export function getHitHistory(index: number): number[] {
  return history.get(index) ? [...(history.get(index) as number[])] : []
}

// 相邻采样的命中增量序列（sparkline 数据源），长度 = 采样数 - 1
export function getHitDeltas(index: number): number[] {
  const samples = history.get(index)
  if (!samples || samples.length < 2) return []
  const deltas: number[] = []
  for (let i = 1; i < samples.length; i++) {
    deltas.push(Math.max(0, samples[i] - samples[i - 1]))
  }
  return deltas
}
