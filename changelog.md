# Rebuild v5.0

> 基于 Clash Party v2.0.2（mihomo-party）重建。
> 本文件同时被 `scripts/updater.mjs`（生成自动更新说明 latest.yml）与 `scripts/telegram.mjs`（发布通知）读取，撰写时保持"当前版本变更"的口径。

## 新增 (Features)

- **`cpx-party` 容器：完整 Clash Party Web UI 进 Docker**——多阶段构建（pnpm install + `prepare.mjs` 下载 linux 内核/geo 资源 + electron-vite 打包 → node:22-slim + Electron 运行库 + xvfb），以官方 `--web` headless 模式运行，自带 mihomo 内核，订阅/覆写/主题全部在浏览器里管理；数据落 `party_data` 卷（`HOME=/data`），重建不丢
- **一键部署双服务**：`./deploy.sh` 构建 gateway + party 双镜像并统一编排（preflight → configure → build → publish → run → verify）；首次自动生成随机 `CP_WEB_TOKEN`；健康检查四项（网关发现 / Web UI / 代理端口 / 面板反代）；npm 依赖默认走 npmmirror（`NPM_REGISTRY` 可覆盖）
- **容器部署感知**：新增 `/.dockerenv` 检测与 `getDeploymentEnv` IPC channel（贯通 preload / web shim / renderer 四层白名单）——系统代理开关在容器内给出可操作提示（引导设备手动配 `:7890`）而非裸 `os error 2`；TUN 开关区分「容器不可用」与「宿主机管理员启动」两种场景；启动时 `disableSysProxy` 噪音日志消除
- **首启种子配置**：entrypoint 自动写入 `allow-lan: true` + 控制器 `0.0.0.0:9090`（仅 compose 内网），LAN 共享代理开箱即用
- **国家双口线路**（`tools/mihomo-lines`）：每国一对端口——通用口分流（国内直连、国外落本国池）、全局口无差别全走本国节点；预置 AU（17890/17891）与 JP（8888/8889）。线路用**纯 YAML 覆写**定义（`include-all` + 正则筛选节点，机场改节点名自动跟随），经 Web UI 的 WS 桥远程下发，全程无需 ssh；另附广告占位节点过滤覆写（判据是 server 为回环地址，与广告文案无关）
- **`/opt` 一键构筑脚本** `deploy/opt/bootstrap.sh`：源码包解压 → docker/外网预检 → 生成 `.env`（`CP_TOKEN` 未指定则随机）与线路端口门 override → 调 `deploy.sh` 构建启动 → 可选从 `party_data.tgz` 恢复数据卷
- **移除内嵌 Sub-Store**：其前后端服务在容器/远程 Web 场景不可用（iframe 指向 `127.0.0.1`），且构建期会从 GitHub 下载 Sub-Store 资源拖慢构建；本次连同主进程 IPC、preload 白名单、共享配置与语言包键一并清理
- **网页图标**：新增 `src/renderer/public/favicon.png`，浏览器标签页不再空白

## 修复 (Fixes)

- 修复网关面板重定向循环：`/` 与 `/ui`、`/ui/` 全部 302 到 `/ui/#/setup?…`，浏览器剥离 hash 后请求 `/ui/` 再次 302 导致 `ERR_TOO_MANY_REDIRECTS`；现仅 `/` 重定向，`/ui*` 透传内核自身的 307（附回归测试）
- 修复 party 容器 electron 无法启动：shell 作为 PID 1 收不到 Xvfb 的 SIGUSR1 就绪信号导致 `xvfb-run` 永久挂起——compose 增加 `init: true`（tini 接管 PID 1）
- 修复 party 镜像构建三坑：`file:src\native\sysproxy` 反斜杠路径 Linux 不可装（构建期 sed 归一）；`prepare` 生命周期脚本在依赖未拷贝时自触发（剔除后显式执行）；pnpm 11 构建脚本审批需要 `pnpm-workspace.yaml` 的 `allowBuilds`（提前 COPY）

## 变更 (Changes)

- **移除 `cpx-mihomo` 容器与 `docker-compose.tun.yml`**：代理端口由 party 容器自带内核接管，网关 `MIHOMO_API_URL` 改指 `party:9090`；订阅从「编辑 `mihomo/config.yaml` + 重启」改为 Web UI 在线管理
- 面板从 metacubexd 切换为 zashboard（Clash Party 默认 `external-ui-url`，随种子配置下发）
- 部署文档 `deploy/gateway/README.md` 按新拓扑重写（拓扑图、一键部署、容器功能边界、FAQ）
- **线路端口门**：`docker-compose.yml` 只映射 AU 通用口 `17890`，其余（AU 全局 `17891` / JP 通用 `8888` / JP 全局 `8889`）由 `docker-compose.override.yml` 补齐——「门（端口映射）与屋（覆写行为）分离」，`bootstrap.sh` 自动写入
- 发布工具链本地化：`scripts/version-utils.mjs` 的下载地址改为从 `package.json` 的 `repository` 派生（不再指向上游 fork 源，避免客户端自动更新跳到上游 release）；`scripts/telegram.mjs` 通知目标改为 `TELEGRAM_CHAT_ID` 环境变量，并移除上游推广链接
