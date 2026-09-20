import { Button, Divider } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { isWeb, platform } from '@renderer/utils/init'
import { isAlwaysOnTop, setAlwaysOnTop } from '@renderer/utils/ipc'
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RiPushpin2Fill, RiPushpin2Line } from 'react-icons/ri'
import { useTranslation } from 'react-i18next'

interface Props {
  title?: React.ReactNode
  header?: React.ReactNode
  children?: React.ReactNode
  contentClassName?: string
}
let saveOnTop = false

const BasePage = forwardRef<HTMLDivElement, Props>((props, ref) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { useWindowFrame = false } = appConfig || {}
  const [overlayWidth, setOverlayWidth] = React.useState(0)
  const [onTop, setOnTop] = useState(saveOnTop)

  const updateAlwaysOnTop = async (): Promise<void> => {
    setOnTop(await isAlwaysOnTop())
    saveOnTop = await isAlwaysOnTop()
  }

  useEffect(() => {
    if (platform !== 'darwin' && !useWindowFrame) {
      try {
        // @ts-ignore windowControlsOverlay
        const windowControlsOverlay = window.navigator.windowControlsOverlay
        // 浏览器（非 PWA）中该 API 存在但矩形宽度为 0，会把避让宽度算成整个窗口宽度，
        // 导致标题栏右侧溢出、标题被压缩成竖排；仅在 overlay 真实可见时才采用测量值。
        if (windowControlsOverlay?.visible) {
          const width = window.innerWidth - windowControlsOverlay.getTitlebarAreaRect().width
          setOverlayWidth(width > 0 && width < window.innerWidth / 2 ? width : 0)
        }
      } catch {
        // ignore
      }
    }
  }, [useWindowFrame])

  const contentRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => {
    return contentRef.current as HTMLDivElement
  })

  return (
    <div ref={contentRef} className="w-full h-full">
      <div className="sticky top-0 z-40 h-12.25 w-full bg-background">
        <div className="app-drag p-2 flex justify-between h-12">
          <div className="title h-full text-lg leading-8 font-medium">{props.title}</div>
          <div style={{ marginRight: overlayWidth }} className="header flex gap-1 h-full">
            {props.header}
            {!isWeb && (
              <Button
                size="sm"
                className="app-nodrag"
                isIconOnly
                title={t('common.pinWindow')}
                variant="light"
                color={onTop ? 'primary' : 'default'}
                onPress={async () => {
                  await setAlwaysOnTop(!onTop)
                  await updateAlwaysOnTop()
                }}
                startContent={
                  onTop ? (
                    <RiPushpin2Fill className="text-lg" />
                  ) : (
                    <RiPushpin2Line className="text-lg" />
                  )
                }
              />
            )}
          </div>
        </div>

        <Divider />
      </div>
      <div className="content h-[calc(100vh-49px)] overflow-y-auto custom-scrollbar">
        {props.children}
      </div>
    </div>
  )
})

BasePage.displayName = 'BasePage'
export default BasePage
