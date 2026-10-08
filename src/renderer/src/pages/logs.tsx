import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Divider, Input, Select, SelectItem, Tab, Tabs } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { getDataUsageBackend, queryLogs, clearLogs, type LogsPageResult } from '@renderer/utils/ipc'

const LOGS_FILTER_KEY = 'logs-filter'
const MAX_CACHED_LOGS = 500
const LOG_RENDER_INTERVAL_MS = 100
const HISTORY_PAGE_SIZE = 200

type HistorySource = '' | 'core' | 'app'
type HistoryLevel = '' | 'debug' | 'info' | 'warning' | 'error'
type HistoryRange = '1h' | '24h' | '7d'

const HISTORY_RANGES: HistoryRange[] = ['1h', '24h', '7d']
const RANGE_MS: Record<HistoryRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

const cachedLogs: {
  log: IMihomoLogInfo[]
  trigger: ((i: IMihomoLogInfo[]) => void) | null
  clean: () => void
} = {
  log: [],
  trigger: null,
  clean(): void {
    this.log = []
    if (this.trigger !== null) {
      this.trigger(this.log)
    }
  }
}

const onLog = (_e: unknown, ...args: unknown[]): void => {
  const log = args[0] as IMihomoLogInfo
  log.time = new Date().toLocaleString()
  cachedLogs.log.push(log)
  if (cachedLogs.log.length > MAX_CACHED_LOGS) {
    cachedLogs.log.splice(0, cachedLogs.log.length - MAX_CACHED_LOGS)
  }
  cachedLogs.trigger?.(cachedLogs.log)
}

// Keep streaming while this page is hidden so returning users can see intervening logs.
// The session cache is bounded by MAX_CACHED_LOGS, so stopping on unmount hurts UX
// without providing meaningful memory savings.
window.electron.ipcRenderer.on('mihomoLogs', onLog)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.electron.ipcRenderer.removeListener('mihomoLogs', onLog)
  })
}

const LiveView: React.FC<{ filter: string; onFilterChange: (v: string) => void }> = (props) => {
  const { filter, onFilterChange } = props
  const { t } = useTranslation()
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(cachedLogs.log)
  const [trace, setTrace] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const filteredLogs = useMemo(() => {
    if (filter === '') return logs
    return logs.filter((log) => {
      return includesIgnoreCase(log.payload, filter) || includesIgnoreCase(log.type, filter)
    })
  }, [logs, filter])

  useEffect(() => {
    const old = cachedLogs.trigger
    let renderTimer: ReturnType<typeof setTimeout> | null = null

    cachedLogs.trigger = (): void => {
      if (renderTimer !== null) return
      renderTimer = setTimeout(() => {
        renderTimer = null
        setLogs([...cachedLogs.log])
      }, LOG_RENDER_INTERVAL_MS)
    }

    return (): void => {
      cachedLogs.trigger = old
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
      }
    }
  }, [])

  return (
    <>
      <div className="w-full flex p-2">
        <Input
          size="sm"
          value={filter}
          placeholder={t('logs.filter')}
          isClearable
          onValueChange={onFilterChange}
        />
        <Button
          size="sm"
          isIconOnly
          className="ml-2"
          color={trace ? 'primary' : 'default'}
          variant={trace ? 'solid' : 'bordered'}
          title={t('logs.autoScroll')}
          onPress={() => {
            setTrace((prev) => !prev)
          }}
        >
          <IoLocationSharp className="text-lg" />
        </Button>
        <Button
          size="sm"
          isIconOnly
          title={t('logs.clear')}
          className="ml-2"
          variant="light"
          color="danger"
          onPress={() => {
            cachedLogs.clean()
          }}
        >
          <CgTrash className="text-lg" />
        </Button>
      </div>
      <div className="h-[calc(100vh-148px)] mt-px">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          initialTopMostItemIndex={filteredLogs.length - 1}
          followOutput={trace}
          itemContent={(i, log) => (
            <LogItem index={i} time={log.time} type={log.type} payload={log.payload} />
          )}
        />
      </div>
    </>
  )
}

const Logs: React.FC = () => {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'live' | 'history'>('live')
  const [filter, setFilter] = useState(() => {
    return localStorage.getItem(LOGS_FILTER_KEY) || ''
  })

  useEffect(() => {
    localStorage.setItem(LOGS_FILTER_KEY, filter)
  }, [filter])

  return (
    <BasePage title={t('logs.title')}>
      <div className="sticky top-0 z-40">
        <div className="w-full flex items-center p-2">
          <Tabs
            size="sm"
            selectedKey={mode}
            onSelectionChange={(k) => setMode(k as 'live' | 'history')}
          >
            <Tab key="live" title={t('logs.live')} />
            <Tab key="history" title={t('logs.history')} />
          </Tabs>
        </div>
        <Divider />
      </div>
      {mode === 'live' ? (
        <LiveView filter={filter} onFilterChange={setFilter} />
      ) : (
        <HistoryView filter={filter} onFilterChange={setFilter} />
      )}
    </BasePage>
  )
}

const HistoryView: React.FC<{ filter: string; onFilterChange: (v: string) => void }> = (props) => {
  const { filter, onFilterChange } = props
  const { t } = useTranslation()
  const [pgOk, setPgOk] = useState<boolean | null>(null)
  const [source, setSource] = useState<HistorySource>('')
  const [level, setLevel] = useState<HistoryLevel>('')
  const [range, setRange] = useState<HistoryRange>('24h')
  const [page, setPage] = useState<LogsPageResult>({ total: 0, rows: [] })
  const [pageNum, setPageNum] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void getDataUsageBackend().then((b) => setPgOk(b.pgConfigured))
  }, [])

  const load = useCallback(
    async (next: number) => {
      setLoading(true)
      try {
        const result = await queryLogs({
          source: source || undefined,
          level: level || undefined,
          keyword: filter || undefined,
          startTime: Date.now() - RANGE_MS[range],
          limit: HISTORY_PAGE_SIZE,
          offset: next * HISTORY_PAGE_SIZE
        })
        setPage(result)
        setPageNum(next)
      } finally {
        setLoading(false)
      }
    },
    [source, level, filter, range]
  )

  useEffect(() => {
    if (pgOk) void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgOk, source, level, range, filter])

  const totalPages = Math.max(1, Math.ceil(page.total / HISTORY_PAGE_SIZE))

  if (pgOk === false) {
    return <div className="p-4 text-sm text-foreground/60">{t('logs.history.noPg')}</div>
  }

  return (
    <>
      <div className="w-full flex flex-wrap items-center gap-2 p-2">
        <Input
          size="sm"
          className="max-w-[220px]"
          value={filter}
          placeholder={t('logs.filter')}
          isClearable
          onValueChange={onFilterChange}
        />
        <Select
          size="sm"
          aria-label={t('logs.source.all')}
          selectedKeys={new Set([source])}
          className="max-w-[130px]"
          onSelectionChange={(keys) => {
            const v = [...keys][0] as HistorySource
            setSource(v ?? '')
          }}
        >
          <SelectItem key="">{t('logs.source.all')}</SelectItem>
          <SelectItem key="core">{t('logs.source.core')}</SelectItem>
          <SelectItem key="app">{t('logs.source.app')}</SelectItem>
        </Select>
        <Select
          size="sm"
          aria-label={t('logs.level.all')}
          selectedKeys={new Set([level])}
          className="max-w-[130px]"
          onSelectionChange={(keys) => {
            const v = [...keys][0] as HistoryLevel
            setLevel(v ?? '')
          }}
        >
          <SelectItem key="">{t('logs.level.all')}</SelectItem>
          <SelectItem key="debug">debug</SelectItem>
          <SelectItem key="info">info</SelectItem>
          <SelectItem key="warning">warning</SelectItem>
          <SelectItem key="error">error</SelectItem>
        </Select>
        <Tabs size="sm" selectedKey={range} onSelectionChange={(k) => setRange(k as HistoryRange)}>
          {HISTORY_RANGES.map((r) => (
            <Tab key={r} title={t(`logs.range.${r}`)} />
          ))}
        </Tabs>
        <div className="ml-auto flex items-center gap-2 text-xs text-foreground/60">
          <span>
            {page.total > 0
              ? t('logs.total', { n: page.total }) + ` · ${pageNum + 1}/${totalPages}`
              : ''}
          </span>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            isDisabled={pageNum === 0 || loading}
            title={t('logs.prev')}
            onPress={() => void load(pageNum - 1)}
          >
            ‹
          </Button>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            isDisabled={pageNum + 1 >= totalPages || loading}
            title={t('logs.next')}
            onPress={() => void load(pageNum + 1)}
          >
            ›
          </Button>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            color="danger"
            title={t('logs.clear')}
            onPress={async () => {
              await clearLogs()
              void load(0)
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
      </div>
      <Divider />
      <div className="h-[calc(100vh-190px)]">
        {page.rows.length === 0 && !loading ? (
          <div className="p-4 text-sm text-foreground/60">{t('logs.empty')}</div>
        ) : (
          <Virtuoso
            data={page.rows}
            itemContent={(i, row) => (
              <LogItem
                index={i}
                time={new Date(row.ts).toLocaleString()}
                type={row.level as IMihomoLogInfo['type']}
                payload={`[${row.source}${row.module ? `/${row.module}` : ''}] ${row.message}`}
              />
            )}
          />
        )}
      </div>
      <div className="px-3 pb-1 text-[11px] text-foreground/40">{t('logs.pgHint')}</div>
    </>
  )
}

export default Logs
