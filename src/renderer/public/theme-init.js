// 首帧闪色修复:在 CSS/React 生效前按已存主题给 <html> 上类并画底色。
// next-themes 要等 React 挂载(WS hello -> 动态 import)才加 .dark 类,样式表却先到,
// 深色主题刷新会闪过一帧浅色底(白光);无样式画布又跟随系统 prefers-color-scheme,
// 深色系统下浅色主题刷新会闪黑。键名与 next-themes 默认 storageKey 一致("theme"),
// 取值语义:dark/light/system,空值时按 next-themes defaultTheme=dark 处理。
// 内联背景色在应用挂载后由 App.tsx 主题 effect 清除,避免压过自定义主题 CSS。
;(function () {
  try {
    var t = localStorage.getItem('theme')
    var dark =
      t === 'dark' ||
      t == null ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
    document.documentElement.style.backgroundColor = dark ? '#000' : '#fff'
  } catch {
    // localStorage 不可用(隐私模式等):跳过,接受首帧闪色
  }
})()
