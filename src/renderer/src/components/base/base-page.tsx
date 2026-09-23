import { Divider } from '@heroui/react'
import { platform } from '@renderer/utils/init'
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

interface Props {
  title?: React.ReactNode
  header?: React.ReactNode
  children?: React.ReactNode
  contentClassName?: string
}

const BasePage = forwardRef<HTMLDivElement, Props>((props, ref) => {
  const [overlayWidth, setOverlayWidth] = React.useState(0)

  useEffect(() => {
    if (platform !== 'darwin') {
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
  }, [])

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
