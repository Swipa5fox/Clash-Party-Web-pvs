// UUID v4：局域网 http 是非安全上下文,crypto.randomUUID 不存在,
// getBytes 兜底后 hex 拼接;安全上下文下走原生实现。
function randomBytesHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // 极端老浏览器:Math.random 熵低,但此处仅用于 monaco URI 去重,可接受
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return [
    randomBytesHex(4),
    randomBytesHex(2),
    '4' + randomBytesHex(1).slice(1),
    ((parseInt(randomBytesHex(1), 16) & 0x3) | 0x8).toString(16) + randomBytesHex(1).slice(1),
    randomBytesHex(6)
  ].join('-')
}
