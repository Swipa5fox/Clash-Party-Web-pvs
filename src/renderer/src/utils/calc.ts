export function calcTraffic(byte: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  let value = byte
  for (let i = 0; i < units.length; i++) {
    if (value < 1024 || i === units.length - 1) return `${formatNumString(value)} ${units[i]}`
    value /= 1024
  }
  return `${formatNumString(value)} YB`
}

function formatNumString(num: number): string {
  let str = num.toFixed(2)
  if (str.length <= 5) return str
  if (str.length === 6) {
    str = num.toFixed(1)
    return str
  } else {
    str = Math.round(num).toString()
    return str
  }
}

export function calcPercent(
  upload: number | undefined,
  download: number | undefined,
  total: number | undefined
): number {
  if (upload === undefined || download === undefined || total === undefined) {
    return 100
  }
  return Math.round(((upload + download) / total) * 100)
}
