import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { CgClose, CgTrash } from 'react-icons/cg'

type SortDirection = 'asc' | 'desc'

interface Props {
  connections: IMihomoConnectionDetail[]
  onOpenDetail: (connection: IMihomoConnectionDetail) => void
  close: (id: string) => void
  visibleColumns: Set<string>
  onColumnWidthChange?: (widths: Record<string, number>) => void
  onSortChange?: (column: string, direction: SortDirection) => void
  columnWidths?: Record<string, number>
  sortColumn?: string
  sortDirection?: SortDirection
}

interface ColumnConfig {
  key: string
  labelKey: string
  width: number
  minWidth: number
  getValue: (connection: IMihomoConnectionDetail) => string | number
  render?: (connection: IMihomoConnectionDetail, t: TFunction) => React.ReactNode
  sortValue?: (connection: IMihomoConnectionDetail) => string | number
}

export const CONNECTION_TABLE_COLUMNS: ColumnConfig[] = [
  {
    key: 'status',
    labelKey: 'connections.detail.status',
    width: 80,
    minWidth: 60,
    getValue: (conn) => (conn.isActive ? 'active' : 'closed'),
    sortValue: (conn) => (conn.isActive ? 1 : 0),
    render: (conn, t) => (
      <Chip color={conn.isActive ? 'primary' : 'danger'} size="sm" radius="sm" variant="dot">
        {conn.isActive ? t('connections.active') : t('connections.closed')}
      </Chip>
    )
  },
  {
    key: 'establishTime',
    labelKey: 'connections.detail.establishTime',
    width: 105,
    minWidth: 80,
    getValue: (conn) => dayjs(conn.start).fromNow(),
    sortValue: (conn) => dayjs(conn.start).unix()
  },
  {
    key: 'type',
    labelKey: 'connections.detail.connectionType',
    width: 120,
    minWidth: 100,
    getValue: (conn) => `${conn.metadata.type}(${conn.metadata.network})`,
    render: (conn) => (
      <span className="text-xs">
        {conn.metadata.type}({conn.metadata.network.toUpperCase()})
      </span>
    )
  },
  {
    key: 'host',
    labelKey: 'connections.detail.host',
    width: 200,
    minWidth: 150,
    getValue: (conn) => conn.metadata.host || '-'
  },
  {
    key: 'sniffHost',
    labelKey: 'connections.detail.sniffHost',
    width: 200,
    minWidth: 150,
    getValue: (conn) => conn.metadata.sniffHost || '-'
  },
  {
    key: 'process',
    labelKey: 'connections.detail.processName',
    width: 150,
    minWidth: 120,
    getValue: (conn) =>
      conn.metadata.process
        ? `${conn.metadata.process}${conn.metadata.uid ? `(${conn.metadata.uid})` : ''}`
        : '-'
  },
  {
    key: 'processPath',
    labelKey: 'connections.detail.processPath',
    width: 250,
    minWidth: 200,
    getValue: (conn) => conn.metadata.processPath || '-'
  },
  {
    key: 'rule',
    labelKey: 'connections.detail.rule',
    width: 150,
    minWidth: 120,
    getValue: (conn) => `${conn.rule}${conn.rulePayload ? `(${conn.rulePayload})` : ''}`
  },
  {
    key: 'proxyChain',
    labelKey: 'connections.detail.proxyChain',
    width: 150,
    minWidth: 120,
    getValue: (conn) => [...conn.chains].reverse().join('>>')
  },
  {
    key: 'sourceIP',
    labelKey: 'connections.detail.sourceIP',
    width: 140,
    minWidth: 120,
    getValue: (conn) => conn.metadata.sourceIP || '-'
  },
  {
    key: 'sourcePort',
    labelKey: 'connections.detail.sourcePort',
    width: 100,
    minWidth: 80,
    getValue: (conn) => conn.metadata.sourcePort || '-'
  },
  {
    key: 'destinationPort',
    labelKey: 'connections.detail.destinationPort',
    width: 100,
    minWidth: 80,
    getValue: (conn) => conn.metadata.destinationPort || '-'
  },
  {
    key: 'inboundIP',
    labelKey: 'connections.detail.inboundIP',
    width: 140,
    minWidth: 120,
    getValue: (conn) => conn.metadata.inboundIP || '-'
  },
  {
    key: 'inboundPort',
    labelKey: 'connections.detail.inboundPort',
    width: 100,
    minWidth: 80,
    getValue: (conn) => conn.metadata.inboundPort || '-'
  },
  {
    key: 'uploadSpeed',
    labelKey: 'connections.uploadSpeed',
    width: 110,
    minWidth: 90,
    getValue: (conn) => `${calcTraffic(conn.uploadSpeed || 0)}/s`,
    sortValue: (conn) => conn.uploadSpeed || 0
  },
  {
    key: 'downloadSpeed',
    labelKey: 'connections.downloadSpeed',
    width: 110,
    minWidth: 90,
    getValue: (conn) => `${calcTraffic(conn.downloadSpeed || 0)}/s`,
    sortValue: (conn) => conn.downloadSpeed || 0
  },
  {
    key: 'upload',
    labelKey: 'connections.uploadAmount',
    width: 100,
    minWidth: 80,
    getValue: (conn) => calcTraffic(conn.upload),
    sortValue: (conn) => conn.upload
  },
  {
    key: 'download',
    labelKey: 'connections.downloadAmount',
    width: 100,
    minWidth: 80,
    getValue: (conn) => calcTraffic(conn.download),
    sortValue: (conn) => conn.download
  },
  {
    key: 'dscp',
    labelKey: 'connections.detail.dscp',
    width: 80,
    minWidth: 60,
    getValue: (conn) => String(conn.metadata.dscp ?? '-')
  },
  {
    key: 'remoteDestination',
    labelKey: 'connections.detail.remoteDestination',
    width: 200,
    minWidth: 150,
    getValue: (conn) => conn.metadata.remoteDestination || '-'
  },
  {
    key: 'dnsMode',
    labelKey: 'connections.detail.dnsMode',
    width: 120,
    minWidth: 100,
    getValue: (conn) => conn.metadata.dnsMode || '-'
  }
]

export const DEFAULT_CONNECTION_TABLE_COLUMN_KEYS = [
  'status',
  'establishTime',
  'type',
  'host',
  'process',
  'rule',
  'proxyChain',
  'remoteDestination',
  'uploadSpeed',
  'downloadSpeed',
  'upload',
  'download'
]

const createColumnWidths = (savedWidths?: Record<string, number>): Record<string, number> =>
  CONNECTION_TABLE_COLUMNS.reduce<Record<string, number>>((widths, column) => {
    widths[column.key] = savedWidths?.[column.key] || column.width
    return widths
  }, {})

const ConnectionTable: React.FC<Props> = ({
  connections,
  onOpenDetail,
  close,
  visibleColumns,
  onColumnWidthChange,
  onSortChange,
  columnWidths: savedColumnWidths,
  sortColumn,
  sortDirection = 'asc'
}) => {
  const { t } = useTranslation()
  const tableRef = useRef<HTMLDivElement>(null)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    createColumnWidths(savedColumnWidths)
  )

  useEffect(() => {
    setColumnWidths(createColumnWidths(savedColumnWidths))
  }, [savedColumnWidths])

  const columns = useMemo(
    () =>
      CONNECTION_TABLE_COLUMNS.filter((column) => visibleColumns.has(column.key)).map((column) => ({
        ...column,
        width: columnWidths[column.key] || column.width
      })),
    [columnWidths, visibleColumns]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, columnKey: string) => {
      e.preventDefault()
      setResizingColumn(columnKey)

      const startX = e.clientX
      const column = CONNECTION_TABLE_COLUMNS.find((c) => c.key === columnKey)
      if (!column) return

      const startWidth = columnWidths[columnKey] || column.width
      let nextWidth = startWidth

      const handleMouseMove = (e: MouseEvent) => {
        const diff = e.clientX - startX
        nextWidth = Math.max(column.minWidth, startWidth + diff)

        setColumnWidths((prev) => ({
          ...prev,
          [columnKey]: nextWidth
        }))
      }

      const handleMouseUp = () => {
        setResizingColumn(null)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        const nextColumnWidths = { ...columnWidths, [columnKey]: nextWidth }
        setColumnWidths(nextColumnWidths)
        onColumnWidthChange?.(nextColumnWidths)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [columnWidths, onColumnWidthChange]
  )

  const handleSort = useCallback(
    (columnKey: string) => {
      const nextDirection = sortColumn === columnKey && sortDirection === 'asc' ? 'desc' : 'asc'
      onSortChange?.(columnKey, nextDirection)
    },
    [sortColumn, sortDirection, onSortChange]
  )

  const sortedConnections = useMemo(() => {
    if (!sortColumn) return connections

    const column = CONNECTION_TABLE_COLUMNS.find((c) => c.key === sortColumn)
    if (!column) return connections

    return [...connections].sort((a, b) => {
      const getSortValue = column.sortValue || column.getValue
      const aValue = getSortValue(a)
      const bValue = getSortValue(b)

      let comparison = 0
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue)
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [connections, sortColumn, sortDirection])

  return (
    <div className="h-full flex flex-col">
      <div ref={tableRef} className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-content2">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="relative border-b border-divider text-left text-xs font-semibold text-foreground-600 px-3 h-10"
                  style={{ width: col.width, minWidth: col.minWidth }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      className="flex-1 text-left hover:text-foreground"
                      onClick={() => handleSort(col.key)}
                    >
                      {t(col.labelKey)}
                      {sortColumn === col.key && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize flex items-center justify-center group"
                      onMouseDown={(e) => handleMouseDown(e, col.key)}
                    >
                      <div
                        className="w-px h-full bg-divider group-hover:bg-primary transition-colors"
                        style={{
                          backgroundColor: resizingColumn === col.key ? 'var(--primary)' : undefined
                        }}
                      />
                    </div>
                  </div>
                </th>
              ))}
              <th className="sticky right-0 border-b border-divider w-12 bg-content2" />
            </tr>
          </thead>
          <tbody>
            {sortedConnections.map((connection) => (
              <tr
                key={connection.id}
                className="border-b border-divider hover:bg-content2 cursor-pointer transition-colors h-12"
                onClick={() => {
                  onOpenDetail(connection)
                }}
              >
                {columns.map((col) => {
                  const value = col.getValue(connection)
                  const content = col.render ? col.render(connection, t) : value

                  return (
                    <td
                      key={col.key}
                      className="px-3 text-sm text-foreground truncate flag-emoji"
                      style={{ maxWidth: col.width }}
                      title={typeof value === 'string' ? value : ''}
                    >
                      {content}
                    </td>
                  )
                })}
                <td className="sticky right-0 bg-inherit" onClick={(e) => e.stopPropagation()}>
                  <Button
                    color={connection.isActive ? 'warning' : 'danger'}
                    variant="light"
                    isIconOnly
                    size="sm"
                    onPress={() => {
                      close(connection.id)
                    }}
                  >
                    {connection.isActive ? (
                      <CgClose className="text-lg" />
                    ) : (
                      <CgTrash className="text-lg" />
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedConnections.length === 0 && (
          <div className="flex items-center justify-center h-32 text-foreground-400">
            {t('connections.table.noData')}
          </div>
        )}
      </div>
    </div>
  )
}

export default ConnectionTable
