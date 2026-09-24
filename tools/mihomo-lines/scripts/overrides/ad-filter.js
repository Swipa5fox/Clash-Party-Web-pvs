/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/explicit-function-return-type -- 本文件由 mihomo-party 覆写沙箱(vm.runInContext 拼接调用 main)消费, 不能含 TS 语法或模块导出 */
// 广告占位节点过滤 —— 全局覆写, 覆写 id: ad-filter
//
// 为什么需要它:
//   部分机场会在订阅里塞两条"广告节点"(如"官址：xxx.example" / "TG群：xxx"),
//   本质是 ss://...@127.0.0.1:11451 —— 指向**客户端本机**的死端口。
//   它们被放在每个选择组的前几位, 一旦被手动选中、或所在组故障转移时被命中,
//   主口(7890)就会去连本机死端口: 内核日志报 `dial tcp 127.0.0.1:11451: connection refused`。
//
// 为什么用覆写而不是手动删节点:
//   手动删只是改了当前 profile, 订阅一刷新广告节点就回来了。覆写在每次生成配置时执行, 永久生效。
//
// 判据:
//   主判据是「server 是回环地址」而不是节点名 —— 机场换广告文案/域名/条数都不影响过滤效果,
//   名字关键字只作为兜底。
//
// 推送(在 scripts/ 目录下执行):
//   node lines.mjs push overrides/ad-filter.js ad-filter '广告节点过滤'
// 撤销: Web UI 的「覆写」页删掉 ad-filter, 或 node lines.mjs push 一个空壳 (不推荐)。

/**
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>} 处理后的 mihomo 配置
 */
function main(config) {
  const LOOPBACK = /^(127\.\d|::1$|localhost$|0\.0\.0\.0$)/i
  const NAME_HINT = /官址|TG群/i
  const isAd = (p) =>
    !!p && (LOOPBACK.test(String(p.server || '')) || NAME_HINT.test(String(p.name || '')))

  const proxies = config.proxies || []
  const removed = new Set(proxies.filter(isAd).map((p) => p.name))
  if (!removed.size) return config

  config.proxies = proxies.filter((p) => !isAd(p))
  // 组里也要剔除引用, 否则成员表里留着已不存在的节点名
  for (const g of config['proxy-groups'] || []) {
    if (Array.isArray(g.proxies)) g.proxies = g.proxies.filter((n) => !removed.has(n))
  }
  return config
}
