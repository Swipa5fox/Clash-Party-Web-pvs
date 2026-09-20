import {
  Button,
  Card,
  CardBody,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  imageDataURL: string
  onCancel: () => void
  onConfirm: (imageDataURL: string) => void
}

interface ImageSize {
  width: number
  height: number
}

interface Crop {
  x: number
  y: number
  size: number
}

interface DragState {
  type: 'move' | 'resize'
  clientX: number
  clientY: number
  crop: Crop
}

const maxOutputSize = 1024
const minCropSizeRatio = 0.05

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

const TrayIconCropModal: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { imageDataURL, onCancel, onConfirm } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageSize, setImageSize] = useState<ImageSize>()
  const [crop, setCrop] = useState<Crop>()
  const [drag, setDrag] = useState<DragState>()

  useEffect(() => {
    setImageSize(undefined)
    setCrop(undefined)
    setDrag(undefined)
  }, [imageDataURL])

  const getRenderedImageRect = (): DOMRect | undefined => imageRef.current?.getBoundingClientRect()

  const getImageDelta = (clientX: number, clientY: number): { dx: number; dy: number } => {
    const rect = getRenderedImageRect()
    if (!rect || !imageSize || !drag) return { dx: 0, dy: 0 }

    return {
      dx: ((clientX - drag.clientX) / rect.width) * imageSize.width,
      dy: ((clientY - drag.clientY) / rect.height) * imageSize.height
    }
  }

  const handleImageLoad = (): void => {
    const image = imageRef.current
    if (!image) return

    const nextImageSize = {
      width: image.naturalWidth,
      height: image.naturalHeight
    }
    const size = Math.min(nextImageSize.width, nextImageSize.height)

    setImageSize(nextImageSize)
    setCrop({
      x: (nextImageSize.width - size) / 2,
      y: (nextImageSize.height - size) / 2,
      size
    })
  }

  const getMinCropSize = (): number => {
    if (!imageSize) return 1

    return Math.max(1, Math.min(imageSize.width, imageSize.height) * minCropSizeRatio)
  }

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    type: DragState['type']
  ): void => {
    if (!crop) return

    wrapperRef.current?.setPointerCapture(e.pointerId)
    setDrag({
      type,
      clientX: e.clientX,
      clientY: e.clientY,
      crop
    })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || !imageSize) return

    const { dx, dy } = getImageDelta(e.clientX, e.clientY)
    if (drag.type === 'resize') {
      const maxSize = Math.min(imageSize.width - drag.crop.x, imageSize.height - drag.crop.y)

      setCrop({
        ...drag.crop,
        size: clamp(drag.crop.size + Math.max(dx, dy), getMinCropSize(), maxSize)
      })
      return
    }

    setCrop({
      ...drag.crop,
      x: clamp(drag.crop.x + dx, 0, imageSize.width - drag.crop.size),
      y: clamp(drag.crop.y + dy, 0, imageSize.height - drag.crop.size)
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDrag(undefined)
  }

  const handleConfirm = (): void => {
    const image = imageRef.current
    if (!image || !crop) return

    const outputSize = Math.max(1, Math.min(maxOutputSize, Math.round(crop.size)))
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, outputSize, outputSize)
    onConfirm(canvas.toDataURL('image/png'))
  }

  const imageRect = getRenderedImageRect()
  const cropStyle =
    imageSize && crop && imageRect
      ? {
          left: `${(crop.x / imageSize.width) * 100}%`,
          top: `${(crop.y / imageSize.height) * 100}%`,
          width: `${(crop.size / imageSize.width) * 100}%`,
          height: `${(crop.size / imageSize.height) * 100}%`
        }
      : undefined

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onCancel}
    >
      <ModalContent className="w-fit max-w-[calc(100vw-64px)] overflow-visible bg-default-100">
        <ModalHeader className="flex app-drag">{t('settings.cropTrayIcon')}</ModalHeader>
        <ModalBody className="overflow-visible">
          <Card
            shadow="none"
            className="w-fit overflow-visible rounded-none border-none bg-default-100"
          >
            <CardBody className="items-center overflow-visible p-2">
              <div
                ref={wrapperRef}
                className="relative inline-block max-h-[60vh] max-w-[calc(100vw-176px)] touch-none select-none overflow-visible rounded-none bg-default-100"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <img
                  ref={imageRef}
                  src={imageDataURL}
                  className="block max-h-[60vh] max-w-[calc(100vw-176px)] rounded-none object-contain"
                  draggable={false}
                  onLoad={handleImageLoad}
                />
                {cropStyle && (
                  <>
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      <div
                        className="absolute rounded-none shadow-[0_0_0_9999px_rgba(0,0,0,0.34)]"
                        style={cropStyle}
                      />
                    </div>
                    <div
                      className="absolute cursor-move rounded-none border-2 border-primary ring-1 ring-background/80"
                      style={cropStyle}
                      onPointerDown={(e) => handlePointerDown(e, 'move')}
                    >
                      <div
                        className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-background bg-primary shadow-small"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          handlePointerDown(e, 'resize')
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" isDisabled={!crop} onPress={handleConfirm}>
            {t('common.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default TrayIconCropModal
