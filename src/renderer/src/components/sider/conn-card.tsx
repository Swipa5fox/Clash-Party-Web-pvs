import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoLink } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  ChartOptions,
  ScriptableContext
} from 'chart.js'
import { useTranslation } from 'react-i18next'

// 注册 Chart.js 组件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

interface Props {
  iconOnly?: boolean
}
const ConnCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { appConfig } = useAppConfig()
  const {
    connectionCardStatus = 'col-span-2',
    disableAnimations = false,
    hideConnectionCardWave = false
  } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/connections')
  const { t } = useTranslation()

  const [upload, setUpload] = useState(0)
  const [download, setDownload] = useState(0)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'connection'
  })
  const [series, setSeries] = useState(Array(10).fill(0))

  // Chart.js 配置
  const chartData = useMemo(() => {
    return {
      labels: Array(10).fill(''),
      datasets: [
        {
          data: series,
          fill: true,
          backgroundColor: (context: ScriptableContext<'line'>) => {
            const chart = context.chart
            const { ctx, chartArea } = chart
            if (!chartArea) {
              return 'transparent'
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)

            // 颜色处理
            const isMatch = location.pathname.includes('/connections')
            const baseColor = isMatch ? '6, 182, 212' : '161, 161, 170' // primary vs foreground 的近似 RGB 值

            gradient.addColorStop(0, `rgba(${baseColor}, 0.8)`)
            gradient.addColorStop(1, `rgba(${baseColor}, 0)`)
            return gradient
          },
          borderColor: 'transparent',
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.4
        }
      ]
    }
  }, [series, location.pathname])

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        display: false
      },
      y: {
        display: false
      }
    },
    elements: {
      line: {
        borderWidth: 0
      }
    },
    interaction: {
      intersect: false
    },
    animation: {
      duration: 0
    }
  }

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  // 使用 useCallback 创建稳定的 handler 引用
  const handleTraffic = useCallback((_e: unknown, ...args: unknown[]) => {
    const info = args[0] as IMihomoTrafficInfo
    setUpload(info.up)
    setDownload(info.down)
    setSeries((prev) => {
      const data = [...prev]
      data.shift()
      data.push(info.up + info.down)
      return data
    })
  }, [])

  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', handleTraffic)
    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoTraffic', handleTraffic)
    }
  }, [handleTraffic])

  if (iconOnly) {
    return (
      <div className={`${connectionCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.connections')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/connections')
            }}
          >
            <IoLink className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${connectionCardStatus} conn-card`}
    >
      {connectionCardStatus === 'col-span-2' ? (
        <>
          <Card
            fullWidth
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
          >
            {!hideConnectionCardWave && (
              <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
                <Line data={chartData} options={chartOptions} />
              </div>
            )}
            <CardBody className="pb-1 pt-0 px-0">
              <div className="flex justify-between">
                <Button
                  isIconOnly
                  className="bg-transparent pointer-events-none"
                  variant="flat"
                  color="default"
                >
                  <IoLink
                    color="default"
                    className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                  />
                </Button>
                <div
                  className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'} `}
                >
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(upload)}/s</div>
                    <FaCircleArrowUp className="h-[24px] leading-[24px]" />
                  </div>
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(download)}/s</div>
                    <FaCircleArrowDown className="h-[24px] leading-[24px]" />
                  </div>
                </div>
              </div>
            </CardBody>
            <CardFooter className="pt-1">
              <h3
                className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {t('sider.cards.connections')}
              </h3>
            </CardFooter>
          </Card>
        </>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <IoLink
                  color="default"
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.connections')}
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default ConnCard
