import React from 'react'
import { Button, Input } from '@heroui/react'
import { MdDeleteForever } from 'react-icons/md'

// 字符串列表编辑器：末尾自动补一行空输入；清空某行即删除该行
export const StringListEditor: React.FC<{
  items: string[]
  placeholder: string
  onChange: (items: string[]) => void
}> = ({ items, placeholder, onChange }) => {
  const handleChange = (value: string, index: number): void => {
    const list = [...items]
    if (value.trim()) {
      if (index < list.length) {
        list[index] = value
      } else {
        list.push(value)
      }
    } else {
      list.splice(index, 1)
    }
    onChange(list)
  }

  const showNewLine = items.every((item) => item.trim() !== '')

  return [...items, ...(showNewLine ? [''] : [])].map((item, index) => (
    <div key={index} className="mt-2 flex">
      <Input
        fullWidth
        size="sm"
        placeholder={placeholder}
        value={item}
        onValueChange={(v) => handleChange(v, index)}
      />
      {index < items.length && (
        <Button
          className="ml-2"
          size="sm"
          variant="flat"
          color="warning"
          onPress={() => handleChange('', index)}
        >
          <MdDeleteForever className="text-lg" />
        </Button>
      )}
    </div>
  ))
}
