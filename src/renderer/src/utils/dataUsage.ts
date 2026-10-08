import {
  getTrafficOverview,
  getSubStatsByHost,
  getDevicesByHost,
  getProxyStatsByHost,
  type DataUsageType,
  type AggregatedData
} from './ipc'

export type { DataUsageType, AggregatedData }

export { getTrafficOverview, getSubStatsByHost, getDevicesByHost, getProxyStatsByHost }
