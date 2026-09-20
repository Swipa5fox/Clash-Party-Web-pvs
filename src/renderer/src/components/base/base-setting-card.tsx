import React, { useState } from 'react'
import { Accordion, AccordionItem, Card, CardBody } from '@heroui/react'
import { IoIosArrowBack } from 'react-icons/io'

interface Props {
  title?: string
  children?: React.ReactNode
  className?: string
}

const SettingCard: React.FC<Props> = (props) => {
  const [isOpen, setIsOpen] = useState(false)

  return !props.title ? (
    <Card className={`${props.className} m-2`}>
      <CardBody>{props.children}</CardBody>
    </Card>
  ) : (
    <Accordion
      isCompact
      className={`${props.className} my-2`}
      variant="splitted"
      onSelectionChange={(keys) => {
        setIsOpen(keys instanceof Set ? keys.size > 0 : false)
      }}
      {...props}
    >
      <AccordionItem
        className="data-[open=true]:pb-2"
        hideIndicator
        keepContentMounted
        textValue={props.title}
        title={
          <div className="flex justify-between items-center w-full">
            <span>{props.title}</span>
            <IoIosArrowBack
              className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 ${isOpen ? '-rotate-90' : ''}`}
            />
          </div>
        }
      >
        {props.children}
      </AccordionItem>
    </Accordion>
  )
}

export default SettingCard
