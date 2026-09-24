import i18next from 'i18next'

// Web 端经局域网 http://<内网IP>:3999 访问时页面不是安全上下文，浏览器不暴露
// navigator.clipboard（127.0.0.1 访问则正常），因此写入退化为隐藏 textarea + execCommand。
// 读取没有等价的兜底手段，只能在不可用时让调用方引导用户手动粘贴。
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 权限被拒等情况下继续走 execCommand 兜底
    }
  }

  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  el.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    el.remove()
  }
  if (!ok) throw new Error(i18next.t('common.error.copyFailed'))
}

export async function readClipboardText(): Promise<string> {
  if (typeof navigator.clipboard?.readText !== 'function') {
    throw new Error(i18next.t('common.error.pasteFailed'))
  }
  return navigator.clipboard.readText()
}
