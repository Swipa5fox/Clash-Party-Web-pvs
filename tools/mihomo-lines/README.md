# mihomo-lines — 线路口与覆写远程管理

对 Clash Party Web（本仓库主程序）做远程运维：双口线路口增删、节点切换、出口验证、链路追踪，以及把仓库里存好的覆写模板推到目标机。全程走 Web UI 的 WS 覆写桥，不 ssh 服务器。

## 环境要求

- 目标机跑着本仓库的 Clash Party Web（`:3999`），可选 gateway（`:8080`，REST 命令需要）
- 本机 Node.js >= 22（内置 WebSocket / fetch）
- 订阅节点名形如 `🇦🇺 高级 | 澳洲 01`（add 按正则匹配节点名）

## 配置（二选一）

v1.3 起登录是账号密码（旧 `?token=` URL 参数已失效）：

```bash
# 方式 A: 环境变量
export LINES_HOST=192.168.x.x LINES_USER=admin LINES_PASSWORD=****
# 可选: gateway 面板令牌(list/switch/verify 的 REST 走 :8080)
export LINES_PANEL_TOKEN=****

# 方式 B: 脚本同目录 lines.config.json（不入库不分享）
{"host":"192.168.x.x","user":"admin","password":"****","panelToken":"****"}
```

user/password 即 Web UI `http://<host>:3999` 的登录账号（初始 admin/admin123）。脚本先 POST `/api/login` 拿 `cp_session` cookie，再连 `/ws` 桥。

## 用法

```bash
node lines.mjs list                                        # 已部署线路 + 当前节点
node lines.mjs add KR 9998 '韩国|Korea|首尔|KR'            # 加双口: 9998 分流口 / 9999 全局口
node lines.mjs add KR 9998 '韩国|Korea' --flat             # 平铺版: 入口组直接挂节点(无子组)
node lines.mjs remove KR                                   # 删双口线路
node lines.mjs switch 'KR·通用[9998]' '🇰🇷 标准 | 韩国 02'  # 切节点
node lines.mjs verify                                      # 出口验证: 国外出口国 + 国内直连 + 小红书
node lines.mjs trace 9998 www.example.com                  # 追一个 CONNECT 实际命中的规则与链路
node lines.mjs push overrides/cn-direct-rules.yaml cn-direct-rules 'CN 国内直连'  # 推覆写模板
```

verify 正确长相（分流口=国内直连，全局口=国内也走代理）：

```
PORT   组名              国外出口  国内出口(应直连)
9998   KR·通用[9998]     KR        直连(203.x.x.x)
9999   KR·全局[9999]     KR        走了代理!
```

## 覆写模板（overrides/）

- `ad-filter.js` — 机场垃圾节点过滤：server 为回环/本地址的主判据 + 节点名关键字兜底（只删节点不动组）
- `cn-direct-rules.yaml` — 国内直连 + 少量强制代理：自建 `include-all` 的「强制代理」组，零订阅组名依赖，换订阅自动适配

推送：`node lines.mjs push <文件> <覆写id> [显示名]`（幂等，同 id 原地更新）。

## 端口门（仅 bridge 网络模式才需要）

默认部署（host 网络）listener 直接绑宿主机，加线路即写即生效。若部署是 bridge + ports 映射，新端口要在 compose 映射后才对外可达（add 完会自动检测并打印提示）。

## 原理（add）

每次 add = 写一个全局覆写（JS），内核重载配置时执行：

- 按正则筛出目标节点，两位编号尾数排序
- 建两个 select 组：`<PREFIX>·通用[<base>]` / `<PREFIX>·全局[<base+1>]`
- 建两个 mixed listener（`0.0.0.0`，支持 UDP）：分流口无绑定走规则，全局口 `proxy:` 绑全局组
- 在 `MATCH` **之前**插入 `IN-NAME,<prefix>-mix,<POOL>`——分流口的流量先进本国池；国内域名/IP 被订阅自带规则更早命中 DIRECT，实现国内直连

## 关键不变量（改代码前必读）

1. **覆写源码烘焙字面量，禁止 `process.env`**——内核重载时在 app 进程执行覆写函数，无环境变量；留 env 会 `undefined` 导致节点全丢。
2. **IN-NAME 必须在 MATCH 前**，否则成死规则，流量穿透到订阅默认 MATCH 组（症状：出口国不是目标国）。
3. **全局口 listener 必须带 `proxy: GLOB`**，否则国内流量直连（症状：全局口 verify 显示「直连」）。
4. 排查链：口不通 → 查门(compose 映射/host) → 查规则(REST `/rules` 里 IN-NAME) → 查组(`/proxies/<组>` 的 now)。
5. verify 探测源必须带 UA（`curl/8.5.0`），ipip.net 无 UA 静默丢包；3322.org 已停服勿用。
