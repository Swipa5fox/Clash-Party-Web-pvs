<h3 align="center">
  <img height='48px' src='./images/icon-white.png#gh-dark-mode-only'>
  <img height='48px' src='./images/icon-black.png#gh-light-mode-only'>
</h3>

<h3 align="center">Another <a href="https://github.com/MetaCubeX/mihomo">Mihomo</a> GUI · LAN Direct-Access Rebuild</h3>

<p align="center">
  <a href="https://github.com/Swipa5fox/Clash-Party-Web-pvs/releases">
    <img src="https://img.shields.io/badge/release-v6.0-blue">
  </a>
  <a href="https://github.com/Swipa5fox/Clash-Party-Web-pvs">
    <img src="https://img.shields.io/badge/fork-Clash%20Party%20v2.0.2-green">
  </a>
</p>
<div align='center'>
<img width='90%' src="./images/preview.jpg">
</div>

### 特性

- [x] 一键 Smart Core 规则覆写，基于 AI 模型自动选择最优节点 详细介绍请看 [这里](https://clashparty.org/docs/guide/smart-core)
- [x] 开箱即用，无需服务模式的 Tun
- [x] 多种配色主题可选，UI 焕然一新
- [x] 支持大部分 Mihomo(Clash Meta) 常用配置修改
- [x] 内置 Smart内核 与 Mihomo(Clash Meta) 内核
- [x] 通过 WebDAV 一键备份和恢复配置
- [x] 强大的覆写功能，任意修订配置文件
- [x] **[Rebuild v1.0]** 机场插件网关支持内网 IP + 纯 HTTP 直连（免域名、免 TLS）
- [x] **[Rebuild v1.0]** 自带 cpx-gateway Docker 一键部署（`deploy/gateway`）
- [x] **[Rebuild v3.0]** deploy.sh 六阶段源码构建流水线（构建/推送/健康检查自动化）
- [x] **[Rebuild v4.0]** Web UI 模式：`--web` headless 启动，浏览器访问完整界面（token 鉴权）
- [x] **[Rebuild v4.0]** 单端口面板：网关 `:8080` 统一反代面板与 mihomo API
- [x] **[Rebuild v4.1]** Docker 跑完整 Clash Party Web UI（`cpx-party` 容器：Electron headless + 自带内核，订阅全在 UI 管理）
- [x] **[Rebuild v4.1]** 一键部署双服务：`./deploy.sh` 自动构建 gateway + party，`CP_WEB_TOKEN` 自动生成，四项健康检查
- [x] **[Rebuild v4.1]** 容器部署感知：系统代理 / TUN 等宿主机专属功能在容器内优雅降级提示（新增 `getDeploymentEnv` channel）
- [x] **[Rebuild v6.0]** 完整 Web 版容器化：`cpx-party`（Electron headless + 自带 mihomo 内核）+ `cpx-gateway`（机场插件网关 + 面板反代），一条 `./deploy.sh` 从源码构建双镜像
- [x] **[Rebuild v6.0]** 国家双口线路（`tools/mihomo-lines`）：每国一对端口（通用分流口 + 全局口），AU/JP 预置，纯 YAML 覆写定义、正则自适应机场节点
- [x] **[Rebuild v6.0]** `/opt` 一键构筑（`deploy/opt/bootstrap.sh`）：解压源码 → 预检 → 生成 .env 与线路端口门 → 构建启动全自动
- [x] **[Rebuild v6.0]** 网页图标：随项目图标的 `favicon.png`，浏览器标签页不再空白
- [x] **[Rebuild v6.0]** 移除内嵌 Sub-Store：容器/远程 Web 场景下不可用（iframe 指向 `127.0.0.1`），构建期也不再下载其前后端
- [x] **[Rebuild v6.0]** 发布链路本地化：自动更新 / 更新说明 / 通知全部指向本仓库，不再被上游版本覆盖

### 安装/使用指南见 [官方文档](https://clashparty.org)

### 更新日志

> 当前版本的变更同时维护在 [`changelog.md`](./changelog.md)——发布脚本（`scripts/updater.mjs` 生成自动更新说明、`scripts/telegram.mjs` 发送通知）读取该文件。

#### v6.0

**新增**

- **`cpx-party` 容器：完整 Clash Party Web UI 进 Docker**——多阶段构建（pnpm install + `prepare.mjs` 下载 linux 内核/geo 资源 + electron-vite 打包 → node:22-slim + Electron 运行库 + xvfb），以官方 `--web` headless 模式运行，自带 mihomo 内核，订阅/覆写/主题全部在浏览器里管理；数据落 `party_data` 卷（`HOME=/data`），重建不丢
- **一键部署双服务**：`./deploy.sh` 现构建 gateway + party 双镜像并统一编排；首次自动生成随机 `CP_WEB_TOKEN`；健康检查扩至四项（网关发现 / Web UI / 代理端口 / 面板反代）；npm 依赖默认走 npmmirror（`NPM_REGISTRY` 可覆盖）
- **容器部署感知**：新增 `/.dockerenv` 检测与 `getDeploymentEnv` IPC channel（贯通 preload/web shim/renderer 四层白名单）——系统代理开关在容器内给出可操作提示（引导设备手动配 `:7890`）而非裸 `os error 2`；TUN 开关区分"容器不可用"与"宿主机管理员启动"两种场景；启动时 `disableSysProxy` 噪音日志消除
- 首启种子配置：entrypoint 自动写入 `allow-lan: true` + 控制器 `0.0.0.0:9090`（仅 compose 内网），LAN 共享代理开箱即用
- **国家双口线路**（`tools/mihomo-lines`）：每国一对端口——通用口分流（国内直连、国外落本国池）、全局口无差别全走本国节点；预置 AU（17890/17891）与 JP（8888/8889）。线路用**纯 YAML 覆写**定义（`include-all` + 正则筛选节点，机场改节点名自动跟随），经 Web UI 的 WS 桥远程下发，全程无需 ssh；另附广告占位节点过滤覆写（判据是 server 为回环地址，与广告文案无关）
- **`/opt` 一键构筑脚本** `deploy/opt/bootstrap.sh`：源码包解压 → docker/外网预检 → 生成 `.env`（`CP_TOKEN` 未指定则随机）与线路端口门 override → 调 `deploy.sh` 构建启动 → 可选从 `party_data.tgz` 恢复数据卷
- **移除内嵌 Sub-Store**：其前后端服务在容器/远程 Web 场景不可用（iframe 指向 `127.0.0.1`），且构建期会从 GitHub 下载 Sub-Store 资源拖慢构建；本次连同主进程 IPC、preload 白名单、共享配置与语言包键一并清理
- **网页图标**：新增 `src/renderer/public/favicon.png`（随项目图标），浏览器标签页不再空白
- **发布链路本地化**：自动更新源（`autoUpdater.ts`）、更新说明的下载地址（`version-utils.mjs` 改为从 `package.json` 派生）、Telegram 通知目标（改为 `TELEGRAM_CHAT_ID` 环境变量）、设置页/更新弹窗/报错页外链——全部指向本仓库；移除上游机场推广链接。此前这些硬编码在上游仓库，会导致客户端「检查更新」拉取上游安装包，**覆盖本 fork 的全部改动**

**Bug 修复**

- 修复网关面板重定向循环：`/` 与 `/ui`、`/ui/` 全部 302 到 `/ui/#/setup?…`，浏览器剥离 hash 后请求 `/ui/` 再次 302 导致 `ERR_TOO_MANY_REDIRECTS`；现仅 `/` 重定向，`/ui*` 透传内核自身的 307（附回归测试）
- 修复 party 容器 electron 无法启动：shell 作为 PID 1 收不到 Xvfb 的 SIGUSR1 就绪信号导致 `xvfb-run` 永久挂起——compose 增加 `init: true`（tini 接管 PID 1）
- 修复 party 镜像构建三坑：`file:src\native\sysproxy` 反斜杠路径 Linux 不可装（构建期 sed 归一）；`prepare` 生命周期脚本在依赖未拷贝时自触发（剔除后显式执行）；pnpm 11 构建脚本审批需要 `pnpm-workspace.yaml` 的 `allowBuilds`（提前 COPY）

**变更**

- **移除 `cpx-mihomo` 容器与 `docker-compose.tun.yml`**：代理端口（7890/7891/7892）由 party 容器自带内核接管，网关 `MIHOMO_API_URL` 改指 `party:9090`；订阅从"编辑 `mihomo/config.yaml` + 重启"改为 Web UI 在线管理
- 面板从 metacubexd 切换为 zashboard（Clash Party 默认 `external-ui-url`，随种子配置下发）
- 部署文档 `deploy/gateway/README.md` 按新拓扑重写（拓扑图、一键部署、容器功能边界、FAQ）
- **线路端口门（门/屋分离）**：`docker-compose.yml` 只映射 AU 通用口 `17890`，其余（AU 全局 `17891` / JP 通用 `8888` / JP 全局 `8889`）由 `docker-compose.override.yml` 补齐——端口映射（门）归 compose，端口行为（屋）归覆写，`bootstrap.sh` 自动写入
- **线路管理迁移为纯 YAML 覆写**：从「JS 覆写 + 节点名正则排序」改为内核原生 `include-all` / `filter` 正则筛选节点，可读性与可维护性提升；订阅为空时组员退化为 `COMPATIBLE(DIRECT)`，不会拖垮内核
- **线路端口门**：`docker-compose.yml` 只映射 AU 通用口 `17890`，其余（AU 全局 `17891` / JP 通用 `8888` / JP 全局 `8889`）由 `docker-compose.override.yml` 补齐——「门（端口映射）与屋（覆写行为）分离」，`bootstrap.sh` 自动写入

#### v4.0

**新增**

- **Web UI 模式**：`electron . --web` 或 `CP_WEB_MODE=1` 以 headless 启动（无窗口/托盘/悬浮窗），mihomo 内核、配置、订阅定时更新照常运行；浏览器打开 `http://127.0.0.1:3999/?token=<随机token>` 即可访问与桌面端完全一致的 React 界面（`pnpm run dev:web` 开发模式）
- **WebSocket RPC 桥**：HTTP 静态服务 + WS 同端口（默认 3999，`CP_WEB_PORT`/`CP_WEB_HOST`/`CP_WEB_TOKEN` 可配），复用主进程 IPC handler 字典，全部约 150 个配置/代理/订阅接口经浏览器可用；事件推送（groupsUpdated/mihomoTraffic 等）实时广播
- **危险 channel 黑名单**：22 个桌面专属 channel（杀进程类 restartAsAdmin/quitApp/resetAppConfig、宿主弹窗类 dialog、路径暴露类 getFilePath/readTextFile 等）在 web 模式统一拒绝，浏览器端无法误杀宿主进程或触发宿主弹窗
- **内容直传通道**：`exportLocalBackupBase64`/`importLocalBackupFromContent`（本地备份浏览器下载/上传）、`importThemesFromContents`（主题内容导入）、`copyEnvText`、`exportGistAgeSecretKeyText`
- **单端口面板**（v3.1 并入）：网关 `:8080` 成为唯一 Web 端口，metacubexd 面板 `/ui`、mihomo REST/WebSocket 全部经网关透明反代，控制器不发布宿主机，面板零密钥
- **Docker TUN 透明代理**：`docker-compose.tun.yml` 叠加配置（Linux 宿主）——双服务 host 网络 + NET_ADMIN + `/dev/net/tun` + ip_forward，一键从端口代理模式切换 TUN 透明代理；mihomo 配置预置 tun 段与控制器收紧说明
- `.gitattributes` 强制 `*.sh`/`Dockerfile` LF 行尾（根治 Windows 检出后脚本在 Linux 报 `'bash\r'` 问题）

**Bug 修复**

- 修复 web 端页面标题竖排显示（`windowControlsOverlay` 在普通浏览器中返回零宽矩形导致标题栏溢出）
- 修复覆写页拖入文件静默失败（上游使用已废弃的 `File.path`，新 Electron 桌面端同样损坏）及 unhandled rejection
- 修复 web 模式下点击 TUN 开关触发宿主弹窗 + 管理员重启导致整个服务退出（"嗅探页崩溃"根因）
- `safeShowErrorBox` web 模式降级为日志，内核故障不再以宿主模态框冻结 WS 桥

**优化**

- 拖拽/打开文件统一改 `file.text()` 浏览器直读（订阅 yaml、覆写 js/yaml、编辑弹窗），web 与桌面体验一致
- web 端隐藏桌面专属 UI：窗口置顶按钮、托盘/悬浮窗/开机自启/全局快捷键/更新安装区块；TUN 开关改为提示引导
- 路径安全加固：`getFileStr`/`setFileStr` 在 web 模式拒绝 dataDir 外的绝对路径（防远程任意文件读写）
- deploy.sh：CRLF 自检 fail-fast；host 网络模式健康检查回退探测（兼容 TUN 叠加）

**部署变更**

- 默认端口代理模式完全不变（`./deploy.sh`）
- TUN 模式：`docker compose -f docker-compose.yml -f docker-compose.tun.yml up -d` + config.yaml 两处注释切换（external-controller → 127.0.0.1:9090、tun: 段启用）
- 提交 `.gitattributes` 后需执行一次 `git add --renormalize .`

#### v3.0

**新增**

- `deploy.sh` 重写为六阶段部署流水线：preflight → configure → build → publish → run → verify
- 源码显式构建镜像（`docker build` 双 tag：`<tag>` + `latest` 别名），支持 `--tag` / `--no-cache`
- 私有仓库支持：`--registry reg:5000`（可选 `--push` 推送，构建/推送解耦）
- 部署后自动健康检查：网关 well-known 探活（动态发现宿主端口）+ mihomo 混合端口 TCP 探活
- CI 无人值守模式：`GATEWAY_ADDR=IP:port ./deploy.sh` 免交互
- 子集部署：`--services mihomo` 只跑代理（跳过网关构建）

**优化**

- compose 中 gateway 构建职责移交脚本：`build: .` 改为 `image: ${GATEWAY_IMAGE:-cpx-gateway:latest}`，手工 `docker compose up` 仍可用 latest 别名兜底
- 预检强化：docker/compose v2/daemon 三重检查，缺一即 fail-fast 并给出修复提示

#### v2.0

**新增**

- Compose 新增 mihomo 代理容器（`cpx-mihomo`）：对局域网设备提供共享代理，默认映射混合端口 7890（HTTP+SOCKS5）、SOCKS5 7891、HTTP 7892
- 代理端口可在 `.env` 自定义（`MIHOMO_MIXED_PORT` / `MIHOMO_SOCKS_PORT` / `MIHOMO_HTTP_PORT`），容器端口固定
- `deploy/gateway/mihomo/config.yaml` 代理模板：订阅 provider、局域网直连规则、可选代理认证

#### v1.0（基于 Clash Party 2.0.2 重建）

**新增**

- 机场插件 v2（cpx-plugin/2）内网直连改造：客户端与网关全链路支持 `http://IP:port`，无需公网域名与 HTTPS 证书
- `deploy/gateway` 参考网关 Docker 一键部署（`./deploy.sh`），明文 8080 直连，SQLite 数据持久化

**移除（安全简化，仅适合可信内网）**

- 客户端 https-only / 公网 host / SSRF guarded-lookup 强制校验
- Ed25519 设备签名与验签（防重放改由一次性 nonce 承担）
- vault 的 safeStorage/Keychain 加密（改为明文 JSON 落盘）

**优化**

- 网关启动 fail-fast：缺少 `PUBLIC_ORIGIN` 时报错退出，不再静默回退
- 清理死代码与过时文档（Caddy/TLS/域名链路、签名向量、net-guard 等）

**部署变更**

- `docker-compose.yml`：移除 caddy 服务，gateway 直接映射宿主 `8080`
- 配置：`DOMAIN` 废弃，`PUBLIC_ORIGIN=http://<IP>:8080` 必填
- 设备表不再存储公钥；`/config`、`/revoke` 请求体不再含 `sig`/`ts` 字段
