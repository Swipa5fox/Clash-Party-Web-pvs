import type { TrafficLogRowInput } from './ipc'

const DB_NAME = 'clashparty_db'
const STORE_NAME = 'data_usage_logs'

// 存量迁移：旧版流量记录存浏览器 IndexedDB，服务端 PG 化后一次性搬走。
// 读出全量 → importDataUsageLogs 入库 → 删 IndexedDB。库不存在/已空则 no-op。
export async function migrateLegacyIndexedDB(
  importLogs: (logs: TrafficLogRowInput[]) => Promise<number>
): Promise<void> {
  if (!('indexedDB' in window)) return

  let db: IDBDatabase
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        // 旧库存在但不触发 upgradeneeded（版本一致）；新建场景说明本来就没数据
        request.transaction?.abort()
        reject(new Error('no legacy db'))
      }
    })
  } catch {
    return
  }

  try {
    const logs: TrafficLogRowInput[] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly')
      const request = tx.objectStore(STORE_NAME).openCursor()
      const rows: TrafficLogRowInput[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          const v = cursor.value as TrafficLogRowInput & { id?: number }
          rows.push({
            timestamp: v.timestamp,
            sourceIP: v.sourceIP,
            host: v.host,
            outbound: v.outbound,
            process: v.process,
            upload: v.upload,
            download: v.download
          })
          cursor.continue()
        } else {
          resolve(rows)
        }
      }
      request.onerror = () => reject(request.error)
    })

    if (logs.length > 0) {
      await importLogs(logs)
    }
    await new Promise<void>((resolve, reject) => {
      db.close()
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })
  } catch {
    // 迁移失败保留旧库，下次进页面重试
  }
}
