# 更新日志

本文件集中记录版本变更。README 只描述当前的能力与实现方式，不写版本历史。

该文件同时是发布流水线的发布说明来源：`scripts/updater.mjs` 读取它生成 `latest.yml`（应用内更新弹窗展示），`scripts/telegram.mjs` 读取它发布到频道。因此最新版本必须排在最前，且内容只在发布时追加，不要随意重排历史条目。

## Rebuild v6.0

### 新增

#### 部署与容器

- **`cpx-party` 容器：完整 Clash Party Web UI 进 Docker**——多阶段构建（pnpm install + `prepare.mjs` 下载 linux 内核/geo 资源 + electron-vite 打包 → node:22-slim + Electron 运行库 + xvfb），以官方 `--web` headless 模式运行，自带 mihomo 内核，订阅/覆写/主题全部在浏览器里管理；数据落 `party_data` 卷（`HOME=/data`），重建不丢
- **一键部署双服务**：`./deploy.sh` 构建 gateway + party 双镜像并统一编排（preflight → configure → build → publish → run → verify）；首次自动生成随机 `CP_WEB_TOKEN`；健康检查四项（网关发现 / Web UI / 代理端口 / 面板反代）；npm 依赖默认走 npmmirror（`NPM_REGISTRY` 可覆盖）
- **`/opt` 一键构筑脚本** `deploy/opt/bootstrap.sh`：源码包解压 → docker/外网预检 → 生成 `.env`（`CP_TOKEN` 未指定则随机）与线路端口门 override → 调 `deploy.sh` 构建启动 → 可选从 `party_data.tgz` 恢复数据卷
- **首启种子配置**：entrypoint 自动写入 `allow-lan: true` + 控制器 `0.0.0.0:9090`（仅 compose 内网），LAN 共享代理开箱即用
- **容器部署感知**：新增 `/.dockerenv` 检测与 `getDeploymentEnv` IPC channel（贯通 preload / web shim / renderer 四层白名单）——系统代理开关在容器内给出可操作提示（引导设备手动配 `:7890`）而非裸 `os error 2`；TUN 开关区分「容器不可用」与「宿主机管理员启动」两种场景；启动时 `disableSysProxy` 噪音日志消除
- **线路端口门（门/屋分离）**：`docker-compose.yml` 只映射 AU 通用口 `17890`，其余（AU 全局 `17891` / JP 通用 `8888` / JP 全局 `8889`）由 `docker-compose.override.yml` 补齐——端口映射（门）由 compose 负责，端口行为（屋）由覆写负责，`bootstrap.sh` 自动写入
- **离线内核构建**：`deploy.sh` 自动把 `/opt/cpx-core-assets`（从已构建镜像提取的 mihomo x3 + sysproxy .node + geo 资源）同步进构建上下文，Dockerfile 检测到即跳过 `prepare.mjs` 联网下载——构建不依赖 github.com 可达性，换网络环境不再重下 238MB；目录不存在时自动回退联网下载（旧行为）

#### 国家双口线路（`tools/mihomo-lines`）

- 每国一对端口：**通用口**分流（国内直连、国外落本国池）、**全局口**无差别全走本国节点；预置 AU（17890/17891）与 JP（8888/8889）
- 线路用**纯 YAML 覆写**定义：`include-all` + `filter` 正则筛选节点，机场改节点名自动跟随，无需硬编码节点列表
- 经 Web UI 的 WebSocket 桥远程下发，**全程无需 ssh**；`list` / `add` / `remove` / `switch` / `verify` / `trace` 子命令
- 附带**广告占位节点过滤**覆写（`ad-filter.js`）：判据是 server 为回环地址，与广告文案/域名无关，订阅刷新后永久生效

#### 自定义线路组（界面化）

- 代理页新增「自定义线路组」：为选定节点集合 + 专属端口生成代理组与 `mixed` 监听端口，全程界面操作、无需手写覆写
- 每个线路组一个入口组，成员为可独立开关的子组（`url-test` 自动 / `fallback` 故障转移 / `select` 手动），子组各自挂载所选节点集合；支持测速 URL 与间隔配置
- 组名冲突自动跳过，同名监听端口覆盖更新；配置经 `getCustomLineGroupsConfig` / `setCustomLineGroupsConfig` IPC channel 存取（preload 与 web shim 白名单已同步登记）

#### 其它

- **移除内嵌 Sub-Store**：其前后端服务在容器/远程 Web 场景不可用（iframe 指向 `127.0.0.1`），且构建期会从 GitHub 下载 Sub-Store 资源拖慢构建；本次连同主进程 IPC、preload 白名单、共享配置与语言包键一并清理
- **网页图标**：新增 `src/renderer/public/favicon.png`，浏览器标签页不再空白
- **发布链路本地化**：`scripts/version-utils.mjs` 的下载地址改为从 `package.json` 的 `repository` 派生；`scripts/telegram.mjs` 通知目标改为 `TELEGRAM_CHAT_ID` 环境变量；移除上游机场推广链接；`src/main/resolve/autoUpdater.ts` 的更新源、设置页 GitHub 按钮、更新日志链接、报错页求助链接全部改指本仓库——避免客户端自动更新拉取上游版本覆盖本 fork

### 修复

- **网关反代加面板门**：`:8080` 单端口面板把 mihomo 的 REST/WebSocket 反代到唯一发布端口，此前任何能摸到该端口的局域网主机都零凭证可控内核——新增 `PANEL_TOKEN` 签名会话 cookie（HttpOnly + SameSite=Lax 兼作 CSRF 防线，服务端零状态），未鉴权 REST 返 401、浏览器 302 到 `/panel/login`、WS 断开；留空关闭门并告警；首次部署自动生成（与 `CP_WEB_TOKEN` 同值）；附 17 例回归测试
- 修复网关面板重定向循环：`/` 与 `/ui`、`/ui/` 全部 302 到 `/ui/#/setup?…`，浏览器剥离 hash 后请求 `/ui/` 再次 302 导致 `ERR_TOO_MANY_REDIRECTS`；现仅 `/` 重定向，`/ui*` 透传内核自身的 307（附回归测试）
- 修复 party 容器 electron 无法启动：shell 作为 PID 1 收不到 Xvfb 的 SIGUSR1 就绪信号导致 `xvfb-run` 永久挂起——compose 增加 `init: true`（tini 接管 PID 1）
- 修复 party 镜像构建三坑：`file:src\native\sysproxy` 反斜杠路径 Linux 不可装（构建期 sed 归一）；`prepare` 生命周期脚本在依赖未拷贝时自触发（剔除后显式执行）；pnpm 11 构建脚本审批需要 `pnpm-workspace.yaml` 的 `allowBuilds`（提前 COPY）
- 修复 Web 端页面标题竖排显示（`windowControlsOverlay` 在普通浏览器中返回零宽矩形导致标题栏溢出）

### 变更

- **移除 `cpx-mihomo` 容器与 `docker-compose.tun.yml`**：代理端口由 party 容器自带内核接管，网关 `MIHOMO_API_URL` 改指 `party:9090`；订阅从「编辑 `mihomo/config.yaml` + 重启」改为 Web UI 在线管理
- 面板从 metacubexd 切换为 zashboard（Clash Party 默认 `external-ui-url`，随种子配置下发）
- 部署文档 `deploy/gateway/README.md` 按新拓扑重写（拓扑图、一键部署、容器功能边界、FAQ）
- 线路管理从「JS 覆写 + 节点名正则排序」迁移为「纯 YAML 覆写 + 内核原生 `include-all`/`filter`」，可读性与可维护性提升，订阅为空时组员退化为 `COMPATIBLE(DIRECT)` 不会拖垮内核
- 文档规范化：README 重写为「定位 / 重要功能 / 技术栈 / 实现方式 / 目录结构 / 快速开始 / 文档 / 安全边界 / 许可证」结构，版本历史全部移入本文件

## Rebuild v5.0

### 新增

- **`cpx-party` 容器：完整 Clash Party Web UI 进 Docker**——多阶段构建（pnpm install + `prepare.mjs` 下载 linux 内核/geo 资源 + electron-vite 打包 → node:22-slim + Electron 运行库 + xvfb），以官方 `--web` headless 模式运行，自带 mihomo 内核，订阅/覆写/主题全部在浏览器里管理；数据落 `party_data` 卷（`HOME=/data`），重建不丢
- **一键部署双服务**：`./deploy.sh` 现构建 gateway + party 双镜像并统一编排；首次自动生成随机 `CP_WEB_TOKEN`；健康检查扩至四项（网关发现 / Web UI / 代理端口 / 面板反代）；npm 依赖默认走 npmmirror（`NPM_REGISTRY` 可覆盖）
- **容器部署感知**：新增 `/.dockerenv` 检测与 `getDeploymentEnv` IPC channel（贯通 preload/web shim/renderer 四层白名单）——系统代理开关在容器内给出可操作提示（引导设备手动配 `:7890`）而非裸 `os error 2`；TUN 开关区分"容器不可用"与"宿主机管理员启动"两种场景；启动时 `disableSysProxy` 噪音日志消除
- 首启种子配置：entrypoint 自动写入 `allow-lan: true` + 控制器 `0.0.0.0:9090`（仅 compose 内网），LAN 共享代理开箱即用

### Bug 修复

- 修复网关面板重定向循环：`/` 与 `/ui`、`/ui/` 全部 302 到 `/ui/#/setup?…`，浏览器剥离 hash 后请求 `/ui/` 再次 302 导致 `ERR_TOO_MANY_REDIRECTS`；现仅 `/` 重定向，`/ui*` 透传内核自身的 307（附回归测试）
- 修复 party 容器 electron 无法启动：shell 作为 PID 1 收不到 Xvfb 的 SIGUSR1 就绪信号导致 `xvfb-run` 永久挂起——compose 增加 `init: true`（tini 接管 PID 1）
- 修复 party 镜像构建三坑：`file:src\native\sysproxy` 反斜杠路径 Linux 不可装（构建期 sed 归一）；`prepare` 生命周期脚本在依赖未拷贝时自触发（剔除后显式执行）；pnpm 11 构建脚本审批需要 `pnpm-workspace.yaml` 的 `allowBuilds`（提前 COPY）

### 变更

- **移除 `cpx-mihomo` 容器与 `docker-compose.tun.yml`**：代理端口（7890/7891/7892）由 party 容器自带内核接管，网关 `MIHOMO_API_URL` 改指 `party:9090`；订阅从"编辑 `mihomo/config.yaml` + 重启"改为 Web UI 在线管理
- 面板从 metacubexd 切换为 zashboard（Clash Party 默认 `external-ui-url`，随种子配置下发）
- 部署文档 `deploy/gateway/README.md` 按新拓扑重写（拓扑图、一键部署、容器功能边界、FAQ）

## Rebuild v4.0

### 新增

- **Web UI 模式**：`electron . --web` 或 `CP_WEB_MODE=1` 以 headless 启动（无窗口/托盘/悬浮窗），mihomo 内核、配置、订阅定时更新照常运行；浏览器打开 `http://127.0.0.1:3999/?token=<随机token>` 即可访问与桌面端完全一致的 React 界面（`pnpm run dev:web` 开发模式）
- **WebSocket RPC 桥**：HTTP 静态服务 + WS 同端口（默认 3999，`CP_WEB_PORT`/`CP_WEB_HOST`/`CP_WEB_TOKEN` 可配），复用主进程 IPC handler 字典，全部约 150 个配置/代理/订阅接口经浏览器可用；事件推送（groupsUpdated/mihomoTraffic 等）实时广播
- **危险 channel 黑名单**：22 个桌面专属 channel（杀进程类 restartAsAdmin/quitApp/resetAppConfig、宿主弹窗类 dialog、路径暴露类 getFilePath/readTextFile 等）在 web 模式统一拒绝，浏览器端无法误杀宿主进程或触发宿主弹窗
- **内容直传通道**：`exportLocalBackupBase64`/`importLocalBackupFromContent`（本地备份浏览器下载/上传）、`importThemesFromContents`（主题内容导入）、`copyEnvText`、`exportGistAgeSecretKeyText`
- **单端口面板**（v3.1 并入）：网关 `:8080` 成为唯一 Web 端口，metacubexd 面板 `/ui`、mihomo REST/WebSocket 全部经网关透明反代，控制器不发布宿主机，面板零密钥
- **Docker TUN 透明代理**：`docker-compose.tun.yml` 叠加配置（Linux 宿主）——双服务 host 网络 + NET_ADMIN + `/dev/net/tun` + ip_forward，一键从端口代理模式切换 TUN 透明代理；mihomo 配置预置 tun 段与控制器收紧说明
- `.gitattributes` 强制 `*.sh`/`Dockerfile` LF 行尾（根治 Windows 检出后脚本在 Linux 报 `'bash\r'` 问题）

### Bug 修复

- 修复 web 端页面标题竖排显示（`windowControlsOverlay` 在普通浏览器中返回零宽矩形导致标题栏溢出）
- 修复覆写页拖入文件静默失败（上游使用已废弃的 `File.path`，新 Electron 桌面端同样损坏）及 unhandled rejection
- 修复 web 模式下点击 TUN 开关触发宿主弹窗 + 管理员重启导致整个服务退出（"嗅探页崩溃"根因）
- `safeShowErrorBox` web 模式降级为日志，内核故障不再以宿主模态框冻结 WS 桥

### 优化

- 拖拽/打开文件统一改 `file.text()` 浏览器直读（订阅 yaml、覆写 js/yaml、编辑弹窗），web 与桌面体验一致
- web 端隐藏桌面专属 UI：窗口置顶按钮、托盘/悬浮窗/开机自启/全局快捷键/更新安装区块；TUN 开关改为提示引导
- 路径安全加固：`getFileStr`/`setFileStr` 在 web 模式拒绝 dataDir 外的绝对路径（防远程任意文件读写）
- deploy.sh：CRLF 自检 fail-fast；host 网络模式健康检查回退探测（兼容 TUN 叠加）

### 部署变更

- 默认端口代理模式完全不变（`./deploy.sh`）
- TUN 模式：`docker compose -f docker-compose.yml -f docker-compose.tun.yml up -d` + config.yaml 两处注释切换（external-controller → 127.0.0.1:9090、tun: 段启用）
- 提交 `.gitattributes` 后需执行一次 `git add --renormalize .`

## Rebuild v3.0

### 新增

- `deploy.sh` 重写为六阶段部署流水线：preflight → configure → build → publish → run → verify
- 源码显式构建镜像（`docker build` 双 tag：`<tag>` + `latest` 别名），支持 `--tag` / `--no-cache`
- 私有仓库支持：`--registry reg:5000`（可选 `--push` 推送，构建/推送解耦）
- 部署后自动健康检查：网关 well-known 探活（动态发现宿主端口）+ mihomo 混合端口 TCP 探活
- CI 无人值守模式：`GATEWAY_ADDR=IP:port ./deploy.sh` 免交互
- 子集部署：`--services mihomo` 只跑代理（跳过网关构建）

### 优化

- compose 中 gateway 构建职责移交脚本：`build: .` 改为 `image: ${GATEWAY_IMAGE:-cpx-gateway:latest}`，手工 `docker compose up` 仍可用 latest 别名兜底
- 预检强化：docker/compose v2/daemon 三重检查，缺一即 fail-fast 并给出修复提示

## Rebuild v2.0

### 新增

- Compose 新增 mihomo 代理容器（`cpx-mihomo`）：对局域网设备提供共享代理，默认映射混合端口 7890（HTTP+SOCKS5）、SOCKS5 7891、HTTP 7892
- 代理端口可在 `.env` 自定义（`MIHOMO_MIXED_PORT` / `MIHOMO_SOCKS_PORT` / `MIHOMO_HTTP_PORT`），容器端口固定
- `deploy/gateway/mihomo/config.yaml` 代理模板：订阅 provider、局域网直连规则、可选代理认证

## Rebuild v1.0（基于 Clash Party 2.0.2 重建）

### 新增

- 机场插件 v2（cpx-plugin/2）内网直连改造：客户端与网关全链路支持 `http://IP:port`，无需公网域名与 HTTPS 证书
- `deploy/gateway` 参考网关 Docker 一键部署（`./deploy.sh`），明文 8080 直连，SQLite 数据持久化

### 移除（安全简化，仅适合可信内网）

- 客户端 https-only / 公网 host / SSRF guarded-lookup 强制校验
- Ed25519 设备签名与验签（防重放改由一次性 nonce 承担）
- vault 的 safeStorage/Keychain 加密（改为明文 JSON 落盘）

### 优化

- 网关启动 fail-fast：缺少 `PUBLIC_ORIGIN` 时报错退出，不再静默回退
- 清理死代码与过时文档（Caddy/TLS/域名链路、签名向量、net-guard 等）

### 部署变更

- `docker-compose.yml`：移除 caddy 服务，gateway 直接映射宿主 `8080`
- 配置：`DOMAIN` 废弃，`PUBLIC_ORIGIN=http://<IP>:8080` 必填
- 设备表不再存储公钥；`/config`、`/revoke` 请求体不再含 `sig`/`ts` 字段

---

## 上游 Clash Party 2.0.2（重建基线）

### 修复 (Fix)

- 修复数字小键盘的加、减、乘、除及小数点按键无法正确注册为全局快捷键的问题
- 修复首次使用欢迎引导中的提示弹层位置配置无效、可能显示异常的问题
- 修复 Linux ARM64 等交叉编译产物可能混入宿主机架构系统代理模块的问题，并增加原生模块架构校验
- 修复 Linux 无法注册托盘图标的问题
