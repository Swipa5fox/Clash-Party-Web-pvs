# mihomo 国家双口线路管理器

给 mihomo party 网关加「国家双口线路」：一条分流口（国内直连+国外走该国节点）+ 一条全局口（全部走该国节点）。全程远程操作（WS 覆写桥），不碰服务器。

## 环境要求

- 网关机器跑着 [mihomo-party](https://github.com/mihomo-party-org/mihomo-party)（docker），对外暴露：
  - `8080` — mihomo 内核 REST API（外部控制器）
  - `3999` — party Web UI（脚本走它的 WS 桥写覆写）
- 本机 Node.js >= 22（内置 WebSocket / fetch）
- 订阅节点名形如 `🇦🇺 高级 | 澳洲 01`（名字含国家关键词即可，正则匹配）

## 配置（二选一）

```bash
# 方式 A: 环境变量
export LINES_HOST=192.168.x.x LINES_TOKEN=<party Web token>

# 方式 B: 脚本同目录 lines.config.json（不入库不分享）
{"host":"192.168.x.x","token":"<party Web token>"}
```

token = 打开 Web UI `http://<host>:3999` 用的那个（party 启动日志里也有 `CP_WEB_TOKEN`）。

## 用法

```bash
node lines.mjs list                                   # 已部署线路 + 当前节点
node lines.mjs add KR 9998 '韩国|Korea|首尔|KR'        # 加国家: 9998 分流口 / 9999 全局口
node lines.mjs remove KR                              # 删国家
node lines.mjs switch 'KR·通用[9998]' '🇰🇷 标准 | 韩国 02'  # 切节点
node lines.mjs verify                                 # 出口验证: 国外出口国 + 国内是否直连
```

verify 正确长相（分流口=国内直连，全局口=国内也走代理）：

```
PORT   组名              国外出口  国内出口(应直连)
9998   KR·通用[9998]     KR        直连(203.x.x.x)
9999   KR·全局[9999]     KR        走了代理!
```

## 端口门（bridge 网络模式才需要）

listener 绑 `0.0.0.0` 在容器内，若 party 容器是默认 bridge + ports 映射，新端口必须在 `docker-compose.override.yml` 映射后才对外可达：

```yaml
services:
  party:
    ports:
      - '9998:9998'
      - '9999:9999'
```

然后 `docker compose up -d party`。脚本 add 完会自动检测，门没开会打印这段提示。

**推荐终局：party 容器用 `network_mode: host`**，listener 直接绑宿主机，加线路零 ssh、即写即生效。注意 compose 的 `ports` 是追加合并，清空要用 `!override []`（compose ≥ 2.24）或直接改 base yml；host 模式下 override 里不能再出现 ports（会冲突报错）。

## 原理

每次 add = 写一个全局覆写（JS），内核重载配置时执行：

- 按正则筛出该国节点，两位编号尾数排序
- 建两个 select 组：`<PREFIX>·通用[<base>]` / `<PREFIX>·全局[<base+1>]`
- 建两个 mixed listener（`0.0.0.0`，支持 UDP）：分流口无绑定走规则，全局口 `proxy:` 绑全局组
- 在 `MATCH` **之前**插入 `IN-NAME,<prefix>-mix,<POOL>`——分流口的流量先进本国池；国内域名/IP 被订阅自带规则更早命中 DIRECT，实现国内直连

## 关键不变量（改代码前必读）

1. **覆写源码烘焙字面量，禁止 `process.env`**——内核重载时在 app 进程执行覆写函数，无环境变量；留 env 会 `undefined` 导致节点全丢。
2. **IN-NAME 必须在 MATCH 前**，否则成死规则，流量穿透到订阅默认 MATCH 组（症状：出口国不是目标国）。
3. **全局口 listener 必须带 `proxy: GLOB`**，否则国内流量直连（症状：全局口 verify 显示「直连」）。
4. 排查链：口不通 → 查门(compose 映射/host) → 查规则(REST `/rules` 里 IN-NAME) → 查组(`/proxies/<组>` 的 now)。
5. verify 探测源必须带 UA（`curl/8.5.0`），ipip.net 无 UA 静默丢包；3322.org 已停服勿用。
