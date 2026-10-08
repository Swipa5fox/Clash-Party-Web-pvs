/* eslint-disable @typescript-eslint/no-unused-vars, no-console, no-undef -- 本文件由 mihomo-party 覆写沙箱(vm.runInContext 拼接调用 main)消费, 不能含 TS 语法或模块导出; 沙箱只注入 console, 它是覆写唯一的输出通道 */
// 机场广告/信息节点过滤 —— 全局覆写, 覆写 id: ad-filter
//
// 过滤对象(订阅里与"走代理"无关的条目):
//   - 广告节点: "官址：home.lilisi.cc" / "TG群：xxx" 之类
//   - 信息节点: "剩余流量：xx GB" / "到期时间：2026-..." / "官网地址" 之类
//   它们本质是 ss://...@127.0.0.1:11451 —— 指向**客户端本机**的死端口。
//   机场把它们放在每个选择组的前几位, 一旦被手动选中、或所在组故障转移时被命中,
//   主口(7890)就会去连本机死端口: 内核日志报 `dial tcp 127.0.0.1:11451: connection refused`。
//
// 为什么用覆写而不是手动删节点:
//   手动删只是改了当前 profile, 订阅一刷新广告节点就回来了。覆写在每次生成配置时执行, 永久生效。
//
// 判据(两条, 任一命中即剔除):
//   1. server 是回环/本地址 —— 主判据, 机场换广告文案/域名/条数都不影响效果。
//   2. 节点名关键字 —— 兜底, 应对机场用真实但无用的 server 塞广告。只匹配节点名,
//      不匹配组名(删组会让引用它的 rules 失效, 内核直接拒绝整份配置)。
//
// 推送(在 scripts/ 目录下执行, 同 id 原地更新):
//   node lines.mjs push overrides/ad-filter.js ad-filter '机场广告/信息节点过滤'
// 本地 Web 模式实例: 在 Web UI 的「覆写」页新建 id=ad-filter、类型 JS、勾"全局" 的覆写,
//   粘贴本文件内容(不含首行 eslint 注释), 保存后重启内核。
// 核对执行结果: override/ad-filter.log 会打印被剔除的节点名。

/**
 * @param {Record<string, any>} config
 * @returns {Record<string, any>} 处理后的 mihomo 配置
 */
function main(config) {
  const DEAD_SERVER = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|localhost|::1)$/i
  const JUNK_NAME =
    /官址|官网|网址|订阅地址|剩余|已用|未用|流量|到期|过期|重置|续费|购买|下单|套餐|客服|公告|通知|防失联|加群|群组|电报|telegram|tg群|t\.me/i

  const isJunk = (p) =>
    !!p &&
    typeof p === 'object' &&
    (DEAD_SERVER.test(String(p.server || '')) || JUNK_NAME.test(String(p.name || '')))

  const proxies = config.proxies || []
  const removed = new Set(proxies.filter(isJunk).map((p) => p.name))
  if (!removed.size) return config

  config.proxies = proxies.filter((p) => !isJunk(p))
  // 组里也要剔除引用, 否则成员表里留着已不存在的节点名
  for (const g of config['proxy-groups'] || []) {
    if (Array.isArray(g.proxies)) {
      g.proxies = g.proxies.filter((n) => !removed.has(n))
      // 全组被清空会让内核拒绝整份配置, 留 DIRECT 保证仍可启动
      if (!g.proxies.length) g.proxies = ['DIRECT']
    }
  }
  console.log(`[ad-filter] removed ${removed.size}: ${[...removed].join(' / ')}`)
  return config
}
