<h3 align="center">
  <img height='48px' src='./images/icon-white.png#gh-dark-mode-only'>
  <img height='48px' src='./images/icon-black.png#gh-light-mode-only'>
</h3>

<h3 align="center">Another <a href="https://github.com/MetaCubeX/mihomo">Mihomo</a> GUI · LAN Direct-Access Rebuild</h3>

<p align="center">
  <a href="https://github.com/Swipa5fox/Clash-Party-Web-pvs/releases">
    <img src="https://img.shields.io/badge/release-v1.4.1-blue">
  </a>
  <a href="https://github.com/Swipa5fox/Clash-Party-Web-pvs">
    <img src="https://img.shields.io/badge/upstream-Clash%20Party%20v2.0.2-green">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-GPL--3.0-orange">
  </a>
</p>
<div align='center'>
<img width='90%' src="./images/preview.jpg">
</div>

基于 [Clash Party](https://github.com/mihomo-party-org/mihomo-party)（Mihomo / Clash Meta 的 Electron 图形客户端，fork 自 v2.0.2）重建的**内网自用版本**：主进程已脱离 Electron、改为纯 Node 服务器，部署到 Linux 主机上，用浏览器访问完整界面，同一容器自带 mihomo 内核供局域网设备共享代理。

> ⚠️ 本项目面向**可信内网**自用：为支持内网直连，移除了传输加密、SSRF 防护与设备签名，凭据改为明文落盘。**不要暴露到公网，也不要对外分发。**

## 当前版本 v1.4.1（2026-10-09）

自 v1.4.0 以来的核心更新（详见 [changelog.md](./changelog.md)）：

- **流量用量接入 PostgreSQL（第一期）**：采集从浏览器 IndexedDB 搬到主进程——订阅内核连接流算增量、5 秒批量入库、30 天保留；查询走 SQL 聚合。未配置 `CP_DATABASE_URL` 时整体关闭，行为同旧版；存量 IndexedDB 数据首次打开「用量」页自动迁移
- **日志接入 PostgreSQL（第二期）**：内核与应用日志双路入库（保留 7 天），logs 页新增「历史」tab，按来源/级别/关键字/时间窗筛选 + 分页查询
- **修复渲染层 IPC 白名单漏登记**：第一期 9 个流量通道只加了主进程 handler 未同步浏览器 shim 白名单，用量页静默显示 0；白名单已抽到 `src/shared/ipcChannels.ts` 并用双向测试锁死，漏登记/残留项都会报红
- **lint warning 全仓清零**（22 → 0，均为等价改写）
- 自 v1.4.0 以历（继承）：gateway 网关栈移除、单容器收敛；线路工具走 WS 桥；`theme-init.js` 刷新首帧闪色修复

## 重要功能

### 代理核心能力（继承上游）

- 开箱即用、无需服务模式的 TUN
- 订阅管理、节点选择、连接与日志、DNS/嗅探配置
- 覆写系统：任意修订配置文件，支持 JS 脚本与 YAML 补丁、age 加密
- WebDAV 备份恢复、多种配色主题、多语言（简中 / 英）

### 重建版新增

- **纯 Node 服务器**：主进程无 Electron（express + WS 桥，esbuild 单文件打包），Linux x64 部署，账号密码登录（初始 admin/admin123，凭据哈希落盘）
- **覆写模板库**（`tools/mihomo-lines`）：`ad-filter.js` 全量机场垃圾节点过滤（回环地址主判据 + 节点名兜底）、`cn-direct-rules.yaml` 国内直连（零订阅组名依赖，换订阅自动适配）；全部命令经 WS 桥远程下发，全程无需 ssh
- **自定义线路组**：在界面上为「选定节点集合 + 专属端口」生成代理组与监听端口，平铺选线器（当前订阅节点多选、广告节点过滤），子组支持 url-test / fallback / select 独立开关，无需手写覆写
- **内核/geo 资源离线化**：`deploy/opt/bootstrap.sh` 支持把 `/opt/cpx-core-assets` 预置资源同步进构建上下文，构建不依赖 github.com 可达性
- **容器部署感知**：容器内点击系统代理 / TUN 时给出可操作提示（引导设备手动配置代理口），而非抛出底层错误
- **发布链路本地化**：自动更新 / 更新说明 / Telegram 通知全部指向本仓库，不再被上游版本覆盖；移除内嵌 Sub-Store（容器场景不可用且拖慢构建）

## 技术栈

| 层           | 选型                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 运行时       | Node 22+（纯 Node 主进程，无 Electron）                                     |
| 内核         | mihomo（Clash Meta）sidecar                                                 |
| 语言         | TypeScript 5.9                                                              |
| 界面         | React 19 + HeroUI + Tailwind CSS 4，配 react-virtuoso、Monaco、d3、chart.js |
| 状态与国际化 | SWR、i18next / react-i18next                                                |
| 构建         | Vite 7（渲染层单入口 `web`）+ esbuild（主进程单文件 server.cjs）            |
| 主进程与桥接 | express（静态服务）、ws（RPC 桥）、axios + http(s)-proxy-agent（出站请求）  |
| 数据存储     | YAML 文件（订阅/覆写/主题/凭据）；可选 PostgreSQL 存流量用量与日志历史      |
| 部署         | Linux tarball + systemd（TUN 走 AmbientCapabilities=CAP_NET_ADMIN）         |
| 质量保障     | vitest（单元 / 集成）、eslint + prettier、tsc 类型检查                      |

## 实现方式

### 主进程与通信

- `src/main`：内核启停与配置生成、订阅更新、覆写执行，IPC handler 集中在单一字典中注册
- `src/renderer`：React 应用，统一通过 `window.electron.ipcRenderer` 调用全部能力

### Web UI：WebSocket RPC 桥

浏览器中无 Node IPC，Web 端以「同形状 shim + 服务端桥」提供全部能力：

- 主进程（server.cjs）用 express 托管 `dist/renderer/web.html` 静态资源，并在同端口（默认 `:3999`）挂 WebSocket
- `src/renderer/src/web/main-web.ts` 在浏览器实现 `window.electron`：invoke 发 `{type:'invoke', id, channel, args}`，结果按 id 回填；事件按 `{type:'event', channel, payload}` 广播
- 服务端 handler 字典（约 150 个 invoke channel）即唯一能力面；HTTP 与 WS 同源、共用 Cookie 会话（登录后签发，TTL 7 天）
- 账号密码登录（初始 admin/admin123，哈希落 `web-auth.json`），失败限次锁定

### 部署拓扑

```text
LAN 浏览器 ──:3999──►┌────────────────────────────────────────┐
                    │ Linux 服务器（node server.cjs）          │
                    │  ├─ 完整 React 界面（订阅/覆写/主题）    │
                    │  └─ 自带 mihomo 内核（sidecar 子进程）   │
                    │       ├─ :7890 混合代理（HTTP+SOCKS5）   │
                    │       ├─ 自定义线路口（Web UI 添加，即写即生效）│
                    │       └─ :9090 控制器（仅 127.0.0.1 回环）│
                    └────────────────────────────────────────┘
LAN 设备 ─────:7890───► 服务器内核（HTTP + SOCKS5 共享代理）
```

### 配置生成流水线

`generateProfile()`（`src/main/core/factory.ts`）按固定次序合成最终配置：

1. 载入基础订阅配置
2. 应用普通覆写（JS 脚本 / YAML 补丁，YAML 支持 age 解密）
3. 应用规则覆写（prepend / append / delete，支持偏移量）
4. 与受控配置 deepMerge（DNS、嗅探、局域网开关等由应用统一管理）
5. **注入自定义线路组**（节点名与当前订阅求交集，失效名字剔除、整组空则跳过）
6. 原子写盘，并按需更新运行时配置缓存

自定义线路组的注入（`applyCustomLineGroups`）：每个线路组生成一个入口组，其成员为启用的子组（`url-test` 自动 / `fallback` 故障 / `select` 手动 / `select` 全局，可单独开关），每个子组挂载所选节点集合；同时创建名为 `<组名>·入口` 的 `mixed` 监听端口。组名冲突时跳过，同名监听端口则覆盖更新。

### 流量用量与日志历史（PostgreSQL，可选）

「用量」页与「日志」页的历史数据存在服务端 PostgreSQL 中，**未配置 `CP_DATABASE_URL` 时两块功能整体关闭**（不采集、页面无数据，实时日志不受影响），其余功能不受影响。

- **流量采集在主进程**：主进程订阅内核 `/connections` 流，按连接 ID 计算上传/下载增量，缓冲后每 5 秒批量写入 `data_usage_logs` 表。因此采集与浏览器无关，关闭页面或没有客户端在线时同样持续记录；保留 30 天
- **日志双路入库**：内核日志流与应用自身日志（`logger.ts` 落盘时同步推送）写入 `logs` 表（来源/级别/模块/内容），保留 7 天；logs 页「历史」tab 按来源/级别/关键字/时间窗筛选并分页查询
- **建表与保留**：首次连接自动 `CREATE TABLE IF NOT EXISTS`（`ts` 上建 BRIN 索引，适配追加型数据），按 `ts` 每日清理过期记录；不引入迁移框架
- **查询走 SQL**：用量页的排行/趋势/下钻（按域名、代理、进程、来源 IP）由 `GROUP BY` 聚合，不再在浏览器本地存储
- **接入**：设置环境变量 `CP_DATABASE_URL` 即可，格式为标准连接串，例如 `postgres://user:pass@127.0.0.1:5433/clash_party`。驱动为纯 JS 的 `pg`，已被 esbuild 内联进 `server.cjs`，部署物仍是单文件
- **零风险回退**：连接失败只记 warning，不阻塞启动；缓冲封顶后丢弃最旧数据

从旧版本升级：浏览器端的 IndexedDB 存量数据在首次打开「用量」页时自动导入 PG 并删除本地库（一次性）。

### 构建与资源

- 主进程（纯 Node，无 Electron）由 esbuild 打成单文件 `dist/server.cjs`；渲染层由 vite 直出 `dist/renderer/`
- `pnpm run build:tarball` 组装 `dist/clash-party-<platform>-<version>-<arch>.tar.gz`（server.cjs + renderer + mihomo 内核 + geo 资源 + systemd unit）
- 内核与 geo 资源由 `scripts/prepare.mjs` 获取（Linux x64/arm64 映射齐备）

## 目录结构

```text
src/
  main/         主进程：内核管理、配置生成与覆写、订阅、handler 字典（纯 Node）
  runtime.ts    纯 Node 运行时环境探测（根目录/版本/语言/数据目录解析）
  renderer/     React 界面（web 单入口）
  shared/       主进程与渲染层共用的类型、i18n 资源
deploy/
  party/        Clash Party Web 容器镜像（Dockerfile + 独立 compose）
  opt/          新机一键构筑脚本（bootstrap.sh）
  release.sh    本机一键打包部署：源码 tar → scp → 服务器构建镜像 + 接管旧容器
  clash-party.service  systemd unit（TUN 用 AmbientCapabilities）
tools/          mihomo-lines：国家双口线路管理（YAML 覆写 + WS 桥下发）
scripts/        构建期资源准备、esbuild 打包、tarball 组装
```

## 快速开始

### Linux 服务器部署（Docker，推荐）

```bash
git clone https://github.com/Swipa5fox/Clash-Party-Web-pvs.git
cd Clash-Party-Web-pvs
docker build -t clash-party:latest -f deploy/party/Dockerfile .
cd deploy/party && docker compose up -d   # host 网络，数据落 /var/lib/clash-party
# 浏览器访问 http://<服务器IP>:3999（初始账号 admin/admin123，首登后请改密）
```

一键构筑（含外网预检、内核资源离线化、健康检查）：`bash deploy/opt/bootstrap.sh <服务器IP>`

**从开发机发版（推荐）**：本机一条命令完成「打包源码 → scp → 服务器构建镜像 → 接管旧容器」：

```bash
bash deploy/release.sh 192.168.110.53
```

- 镜像在旧容器仍在服务时**预构建**，停机窗口只有容器交接的几秒
- 自动从现役旧部署捕获 `CP_DATABASE_URL` 写成 override（PG 用量/日志入库不断链），并 seed Linux 内核进构建上下文（构建不碰 GitHub）
- 旧部署目录 `/opt/clash-party` 原样保留；回滚：`ssh <host> 'docker rm -f clash-party && cd /opt/clash-party && docker compose up -d --build'`

**启用「用量」统计与「日志」历史查询（可选）**：加一个 PostgreSQL 服务并把连接串传给 party 容器即可（PG 只绑回环，不对 LAN 暴露）：

```yaml
services:
  clash-party:
    environment:
      CP_DATABASE_URL: postgres://clash_party:改掉这个密码@127.0.0.1:5433/clash_party
  postgres:
    image: postgres:18
    container_name: clash-party-pg
    restart: unless-stopped
    environment:
      POSTGRES_DB: clash_party
      POSTGRES_USER: clash_party
      POSTGRES_PASSWORD: 改掉这个密码
    volumes:
      - /var/lib/clash-party-pg:/var/lib/postgresql
    ports:
      - 127.0.0.1:5433:5432
```

表结构、保留策略（流量 30 天 / 日志 7 天）由 party 首次连接时自动建立，无需手工执行 SQL。详见 [实现方式 → 流量用量与日志历史](#流量用量与日志历史postgresql可选)。

### Linux 服务器部署（tarball + systemd）

```bash
pnpm install
pnpm run prepare      # 下载 mihomo 内核与 geo 资源到 extra/
pnpm run build:tarball

# 服务器上：
tar -xzf dist/clash-party-linux-*-x64.tar.gz -C /opt/
# tarball 顶层目录是 clash-party/（即 /opt/clash-party），与 unit 内路径一致
sudo cp /opt/clash-party/deploy/clash-party.service /etc/systemd/system/
sudo systemctl enable --now clash-party
# 浏览器访问 http://<服务器IP>:3999（初始账号 admin/admin123，首登后请改密）
```

- TUN 模式需要 `CAP_NET_ADMIN`（unit 已配置 `AmbientCapabilities`）与 `/dev/net/tun`
- 数据目录默认 `CP_DATA_DIR`（unit 中为 `/var/lib/clash-party`）；本机开发默认 `~/.local/share/clash-party`
- 需要用量统计时，在 unit 里加 `Environment=CP_DATABASE_URL=postgres://user:pass@127.0.0.1:5433/clash_party`

### 本机开发

```bash
pnpm install
pnpm run dev          # vite dev server + tsx 主进程，浏览器访问 :3999
```

| 端口   | 用途                                                  |
| ------ | ----------------------------------------------------- |
| `3999` | Clash Party Web UI（账号密码登录，Cookie 会话鉴权）   |
| `7890` | 局域网共享代理（HTTP + SOCKS5 混合口）                |
| 任意   | 自定义线路组端口：Web UI 即写即生效（仅需放行防火墙） |

## 文档

- 官方使用文档：<https://clashparty.org>
- 版本变更记录：[`changelog.md`](changelog.md)

## 安全边界

本重建版为内网直连做了以下简化，**仅适合可信内网自用**：

- 机场插件客户端允许纯 HTTP 与内网 host 的网关地址，不强制 HTTPS，也不拦截私网地址（便于订阅源放内网）
- 移除 Ed25519 设备签名，防重放改由一次性 nonce 承担
- vault 明文 JSON 落盘，不再使用系统 Keychain / safeStorage 加密
- Web UI 账号密码登录 + Cookie 会话；凭据哈希落盘但无 HTTPS 时口令经内网明文传输，请勿暴露公网；mihomo 控制器仅绑 `127.0.0.1`，不对 LAN 暴露（仅宿主机本机可 `curl 127.0.0.1:9090` 打裸 REST 应急）
- PostgreSQL（可选）同样只绑 `127.0.0.1`，不对 LAN 暴露；连接串经环境变量注入，请替换示例密码，勿沿用文档里的占位值

## 许可证与致谢

- 本项目基于 [Clash Party](https://github.com/mihomo-party-org/mihomo-party) v2.0.2 重建，遵循 [GPL-3.0](LICENSE)
- 内核：[mihomo](https://github.com/MetaCubeX/mihomo)（Clash Meta）
