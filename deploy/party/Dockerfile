# clash-party — v1.3+ 纯 Node Web UI + mihomo sidecar（Docker，多阶段构建）。
#
# 构建上下文：仓库根（不是本目录）：
#   docker build -t clash-party:latest -f deploy/party/Dockerfile .
#   （或由 deploy/opt/bootstrap.sh 统一构建）
#
# v1.3 起主进程脱离 Electron：builder 里 pnpm install + vite + esbuild 出
#   dist/server.cjs（单文件，生产依赖全内联，运行时无 node_modules）
#   dist/renderer/（静态前端）
# 运行时镜像只需 node + Linux mihomo sidecar + geo 资源。
#
# Host 侧固定端口（compose 用 network_mode: host）：
#   3999 Web UI（CP_WEB_PORT）  7890 mihomo mixed 代理（HTTP+SOCKS5）
#   + Web UI 运行时新增的自定义线路组监听口。
# 控制器（127.0.0.1:9090）仅回环——只有宿主机本机可达，LAN 直连不到；应急
# 面板/裸 REST 走 ssh -L 9090:127.0.0.1:9090 隧道，日常管理面就是 :3999 Web UI。
#
# 鉴权：账号密码登录（初始凭据见 deploy.sh 部署汇总）。旧 CP_WEB_TOKEN 已随 v1.3 移除。

# ------------------------------------------------------------------ builder --
FROM node:22-slim AS builder

# npm registry 覆盖（deploy.sh 默认 npmmirror，境内网络用）；corepack 也用它拉 pnpm。
# GitHub 加速前缀（留空=直连 github.com）。内核/geo 资源有两个来源：
#   1. 已同步进 extra/（deploy.sh 从 /opt/cpx-core-assets 拷贝，或本机 pnpm prepare
#      已下载）——构建不碰 github.com
#   2. 兜底：scripts/prepare.mjs 下载（需要 github.com 或 GITHUB_MIRROR）
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG GITHUB_MIRROR=
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    GITHUB_MIRROR=${GITHUB_MIRROR}

WORKDIR /src

# corepack 依据 package.json 的 "packageManager": pnpm@x 启用。
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# "prepare" 生命周期脚本（prepare.mjs 下载内核/geo）此刻 scripts/ 还没 COPY 进来
# （鸡生蛋），先剥掉再装依赖；内核/geo 在依赖装完后显式跑一次。
RUN sed -i '/"prepare":/d' package.json \
    && pnpm install --no-frozen-lockfile --registry="${NPM_REGISTRY}"

COPY . .

# 内核/geo 资源：已在 extra/（Windows 本机 pnpm prepare 产物同步、或 deploy.sh
# 从 /opt/cpx-core-assets 预置）则直接用——注意 Windows 检出的 extra/sidecar 里
# 可能是 mihomo.exe（win32-x64），那对 Linux 容器没用，必须换成 linux 内核。
# 只有存在 Linux ELF 内核时才跳过下载。
RUN if [ -f extra/sidecar/mihomo ] && [ -f extra/files/geoip.metadb ]; then \
      echo '[build] using pre-synced core assets (skip prepare.mjs)'; \
    else \
      echo '[build] core assets missing, downloading via prepare.mjs'; \
      node scripts/prepare.mjs; \
    fi \
    && chmod 755 extra/sidecar/mihomo \
    && pnpm run build

# ------------------------------------------------------------------ runtime --
FROM node:22-slim

# mihomo 是 Go 二进制，在 Linux 上读系统 CA 信任库（不内置）——
# 缺了它订阅 HTTPS 拉取会证书校验失败；node 自带 CA 不受影响。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# tarball 同构布局：server.cjs + package.json（runtime.ts 探测根/版本用）+
# renderer/ + resources/（sidecar 内核与 geo）。runtime.ts 在 /app 下发现
# package.json 即认定根；resources/ 存在 → resourcesDir()= /app/resources，
# 数据目录落 CP_DATA_DIR。
COPY --from=builder /src/dist/server.cjs ./server.cjs
COPY --from=builder /src/package.json ./package.json
COPY --from=builder /src/dist/renderer ./renderer
COPY --from=builder /src/extra ./resources
COPY deploy/party/entrypoint.sh /usr/local/bin/clash-party-entrypoint
RUN chmod +x /usr/local/bin/clash-party-entrypoint

# CP_DATA_DIR=/data：订阅/覆写/凭据/日志全部落卷，容器重建不丢。
# CP_WEB_HOST=0.0.0.0 是 LAN 部署的硬要求（代码默认 127.0.0.1，见 index.ts）。
ENV CP_DATA_DIR=/data \
    CP_WEB_HOST=0.0.0.0 \
    NODE_ENV=production

ENTRYPOINT ["clash-party-entrypoint"]
