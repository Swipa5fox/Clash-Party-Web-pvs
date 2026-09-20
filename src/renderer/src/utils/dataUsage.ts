import { db, type DataUsageLog } from '@renderer/utils/db'

export type DataUsageType = 'sourceIP' | 'host' | 'outbound' | 'process'

export interface AggregatedData {
  label: string
  upload: number
  download: number
  total: number
  count: number
}

interface TrafficTrendPoint {
  timestamp: number
  upload: number
  download: number
}

function addAggregatedLog(
  map: Map<string, AggregatedData>,
  label: string,
  log: DataUsageLog
): void {
  const existing = map.get(label)
  if (existing) {
    existing.upload += log.upload
    existing.download += log.download
    existing.total += log.upload + log.download
    existing.count += 1
    return
  }

  map.set(label, {
    label,
    upload: log.upload,
    download: log.download,
    total: log.upload + log.download,
    count: 1
  })
}

function sortAggregatedData(map: Map<string, AggregatedData>): AggregatedData[] {
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function getDimensionLabel(type: DataUsageType, log: DataUsageLog): string {
  switch (type) {
    case 'sourceIP':
      return log.sourceIP
    case 'host':
      return log.host
    case 'outbound':
      return log.outbound
    case 'process':
      return log.process
  }
}

export async function getTrafficOverview(
  type: DataUsageType,
  startTime: number,
  endTime: number,
  bucketSizeMs: number
): Promise<{ rankings: AggregatedData[]; trend: TrafficTrendPoint[] }> {
  const rankings = new Map<string, AggregatedData>()
  const buckets = new Map<number, { upload: number; download: number }>()

  for (let time = startTime; time <= endTime; time += bucketSizeMs) {
    buckets.set(Math.floor(time / bucketSizeMs) * bucketSizeMs, { upload: 0, download: 0 })
  }

  await db.iterate(startTime, endTime, (log) => {
    addAggregatedLog(rankings, getDimensionLabel(type, log), log)

    const bucket = buckets.get(Math.floor(log.timestamp / bucketSizeMs) * bucketSizeMs)
    if (bucket) {
      bucket.upload += log.upload
      bucket.download += log.download
    }
  })

  return {
    rankings: sortAggregatedData(rankings),
    trend: Array.from(buckets.entries())
      .map(([timestamp, data]) => ({ timestamp, ...data }))
      .sort((a, b) => a.timestamp - b.timestamp)
  }
}

export async function getSubStatsByHost(
  dimension: Exclude<DataUsageType, 'host'>,
  label: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const map = new Map<string, AggregatedData>()

  await db.iterate(startTime, endTime, (log) => {
    if (getDimensionLabel(dimension, log) === label) {
      addAggregatedLog(map, log.host, log)
    }
  })

  return sortAggregatedData(map)
}

export async function getDevicesByHost(
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const map = new Map<string, AggregatedData>()

  await db.iterate(startTime, endTime, (log) => {
    if (log.host === host) {
      addAggregatedLog(map, log.sourceIP, log)
    }
  })

  return sortAggregatedData(map)
}

export async function getProxyStatsByHost(
  dimension: DataUsageType,
  parentLabel: string,
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const map = new Map<string, AggregatedData>()

  await db.iterate(startTime, endTime, (log) => {
    if (log.host === host && getDimensionLabel(dimension, log) === parentLabel) {
      addAggregatedLog(map, log.outbound, log)
    }
  })

  return sortAggregatedData(map)
}

export async function getDevicesByProxyAndHost(
  proxy: string,
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const map = new Map<string, AggregatedData>()

  await db.iterate(startTime, endTime, (log) => {
    if (log.outbound === proxy && log.host === host) {
      addAggregatedLog(map, log.sourceIP, log)
    }
  })

  return sortAggregatedData(map)
}
