export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      const dataUrl = String(reader.result ?? '')
      const commaIndex = dataUrl.indexOf(',')
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl)
    }
    reader.onerror = (): void => reject(reader.error)
    reader.readAsDataURL(file)
  })
