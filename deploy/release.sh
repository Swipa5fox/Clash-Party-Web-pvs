#!/usr/bin/env bash
# release.sh — 一键打包部署：本机源码 → 服务器 Docker 构建起容器。
#
# 用法（本机 Git Bash / Linux，SSH 免密）:
#   bash deploy/release.sh 192.168.110.53
#   HOST=192.168.110.53 bash deploy/release.sh          # 同上
#   bash deploy/release.sh 192.168.110.53 --skip-build  # 只打包推送，不在服务器构建
#
# 做五件事:
#   1. 本机打包源码 tar.gz（构建所需源码 + extra/files geo 资源；node_modules/.git/
#      本地产物/Windows 二进制全排除——builder 里 pnpm install 重装）
#   2. scp 上传到服务器 /opt/cpx-src.tar.gz 并解压
#   3. 服务器预检 + 从现役旧部署 seed Linux 内核（构建不碰 GitHub）+ 预构建镜像
#   4. 接管旧容器（捕获 CP_DATABASE_URL 写 override、摘旧容器名）→ bootstrap.sh
#      构建镜像 + compose up（镜像已预构建，秒级）
#   5. 健康检查 + 部署汇总
#
# 停机窗口: 只在「摘旧容器 → 新容器 up」之间（秒级）；镜像构建在旧容器仍在跑时完成。
# 回滚:     旧部署目录 /opt/clash-party 原样保留，cd /opt/clash-party && docker compose up -d --build
#
# 环境变量:
#   HOST=192.168.110.53   目标服务器（或第 1 个位置参数）
#   SSH_USER=root         SSH 用户
#   SSH_PORT=22           SSH 端口
#   REPO_NAME=<目录名>    覆盖源码目录名（默认取本地仓库目录名，服务器解压同名）
#   NPM_REGISTRY / GITHUB_MIRROR   透传构建期镜像源
#   SKIP_BUILD=true       只打包推送不构建
#   KEEP_TARBALL=false    部署完删服务器上的 tar 包（默认保留）
set -euo pipefail

# 自愈 CRLF（Windows 编辑器改过脚本时防炸）
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0" && exec bash "$0" "$@"
fi

HOST="${HOST:-}"
SKIP_BUILD="${SKIP_BUILD:-false}"
for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=true ;;
    -*) echo "未知参数: $a" >&2; exit 1 ;;
    *) HOST="$a" ;;
  esac
done
[ -n "$HOST" ] || { echo "用法: bash deploy/release.sh <服务器IP>  (或 HOST=... 环境变量)" >&2; exit 1; }

SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
OPT_ROOT="${OPT_ROOT:-/opt}"
KEEP_TARBALL="${KEEP_TARBALL:-false}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Git Bash/MSYS：pwd 可能继承 Windows 风格 PWD（D:\... 形式），路径里的冒号
# 会被 tar -f / scp 当「远端主机:路径」解析（Cannot connect to D: resolve failed）。
# 归一成 POSIX 形式（/d/...），后续 tar/scp 全部安全。
case "${OSTYPE:-}" in msys*|cygwin*)
  command -v cygpath >/dev/null 2>&1 && ROOT="$(cygpath -u "$ROOT")" ;; esac
REPO_NAME="${REPO_NAME:-$(basename "$ROOT")}"
REMOTE_TARBALL="${OPT_ROOT}/cpx-src.tar.gz"
REMOTE_ROOT="${OPT_ROOT}/${REPO_NAME}"

log()  { printf '\033[1;35m[rel]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rel][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
SSH()  { ssh -p "$SSH_PORT" "${SSH_USER}@${HOST}" "$@"; }

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
[ -n "$VERSION" ] || VERSION=dev
log "目标: ${SSH_USER}@${HOST}:${SSH_PORT}  版本: ${VERSION}  源码根: $ROOT"

# ------------------------------------------------------ 1. 本机打包 ---
log "Stage 1/5: 打包源码"
LOCAL_TGZ="$(dirname "$ROOT")/clash-party-src-${VERSION}.tar.gz"
# 排除规则与 .dockerignore 对齐，再追加本地敏感/不入库文件（见 .gitignore）。
# extra/sidecar 的 Windows 二进制(~60MB)剔除——Linux 内核由 Stage 3 从旧部署 seed。
if ! tar -czf "$LOCAL_TGZ" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='out' \
  --exclude='release' \
  --exclude='extra/sidecar/*.exe' \
  --exclude='extra/sidecar/*win32*.node' \
  --exclude='extra/sidecar/*darwin*.node' \
  --exclude='*.cpx' \
  --exclude='tools/mihomo-lines/scripts/lines.config.json' \
  --exclude='.vscode' --exclude='.idea' --exclude='.codegraph' \
  --exclude='.codebuddy' --exclude='.codebelly' --exclude='.trae' \
  --exclude='*.tsbuildinfo' --exclude='*.log*' \
  --exclude='party.md' --exclude='CLAUDE.md' --exclude='AGENTS.md' --exclude='agent.md' \
  -C "$(dirname "$ROOT")" "$REPO_NAME"; then
  fail "tar 打包失败"
fi
log "打包完成: $LOCAL_TGZ ($(du -h "$LOCAL_TGZ" | cut -f1))"

# ------------------------------------------------------ 2. 上传解压 ---
log "Stage 2/5: 上传到 ${HOST}:${REMOTE_TARBALL}"
SSH "mkdir -p '${OPT_ROOT}'"
scp -P "$SSH_PORT" -q "$LOCAL_TGZ" "${SSH_USER}@${HOST}:${REMOTE_TARBALL}" \
  || fail "上传失败（检查 SSH 免密/端口 ${SSH_PORT}）"
log "上传完成"

if [ "$SKIP_BUILD" = "true" ]; then
  log "SKIP_BUILD=true：tar 已推送。手工构建: ssh ${SSH_USER}@${HOST} 'bash ${REMOTE_ROOT}/deploy/opt/bootstrap.sh ${HOST}'"
  exit 0
fi

# --------------------- 3. 预检 + seed 内核 + 预构建（旧容器仍在跑） ---
log "Stage 3/5: 服务器预检 + seed 内核 + 预构建镜像（旧服务不中断）"
# REPO_NAME/VERSION 经 env 传入远程脚本（heredoc 单引号不展开本地变量）。
SSH "REPO_NAME='${REPO_NAME}' VERSION='${VERSION}' \
     NPM_REGISTRY='${NPM_REGISTRY:-https://registry.npmmirror.com}' \
     GITHUB_MIRROR='${GITHUB_MIRROR:-}' bash -s" <<'REMOTE'
set -euo pipefail
log()  { printf '\033[1;34m[rel-r]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[rel-r][warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rel-r][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

ROOT="/opt/${REPO_NAME}"
command -v docker >/dev/null 2>&1 || fail "服务器未装 Docker"
docker compose version >/dev/null 2>&1 || fail "缺 Docker Compose v2 插件"
docker info >/dev/null 2>&1 || fail "Docker 守护进程不可达"
AVAIL_KB=$(df -Pk /opt | awk 'NR==2 {print $4}')
[ "$AVAIL_KB" -ge 2097152 ] || fail "/opt 可用空间不足 2G（当前 $((AVAIL_KB/1024))M）"

rm -rf "$ROOT"
tar -xzf /opt/cpx-src.tar.gz -C /opt
[ -f "$ROOT/deploy/party/Dockerfile" ] || fail "包结构不符: 缺 $ROOT/deploy/party/Dockerfile"

# Linux 内核 seed（本机 extra 只有 Windows 二进制）：
# 优先老预置目录 /opt/cpx-core-assets/extra，其次现役旧部署 /opt/clash-party/resources
# （tarball 布局与 extra/ 同构）。Dockerfile 检测到 Linux ELF 即跳过联网下载。
SEED_FROM=""
[ -d /opt/cpx-core-assets/extra ] && SEED_FROM=/opt/cpx-core-assets/extra
[ -z "$SEED_FROM" ] && [ -f /opt/clash-party/resources/sidecar/mihomo ] \
  && [ -f /opt/clash-party/resources/files/geoip.metadb ] && SEED_FROM=/opt/clash-party/resources
if [ -n "$SEED_FROM" ] && [ ! -f "$ROOT/extra/sidecar/mihomo" ]; then
  log "seed Linux 内核/geo: ${SEED_FROM} -> extra/（构建不依赖 GitHub）"
  mkdir -p "$ROOT/extra"
  cp -au "${SEED_FROM}/." "$ROOT/extra/"
else
  warn "无预置内核资源，构建将联网下载（需 github.com 可达或 GITHUB_MIRROR）"
fi

# 预构建镜像（旧容器仍在服务）：bootstrap 后续的 docker build 直接命中缓存。
BUILD_LOG=/tmp/cpx-rel-build.log
if docker build \
  --build-arg NPM_REGISTRY="${NPM_REGISTRY}" \
  --build-arg GITHUB_MIRROR="${GITHUB_MIRROR}" \
  -t "clash-party:${VERSION}" \
  -t clash-party:latest \
  -f "$ROOT/deploy/party/Dockerfile" "$ROOT" >"$BUILD_LOG" 2>&1; then
  log "镜像预构建完成: clash-party:${VERSION}"
else
  tail -40 "$BUILD_LOG" >&2
  fail "镜像构建失败（上方为日志尾部，全量: $BUILD_LOG）"
fi
REMOTE

# ---------------- 4. 接管旧容器（捕获 PG env）→ bootstrap 起 --
log "Stage 4/5: 接管旧容器 + compose 启动（停机窗口从此刻开始）"
SSH "REPO_NAME='${REPO_NAME}' bash -s" <<'REMOTE'
set -euo pipefail
log()  { printf '\033[1;34m[rel-r]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rel-r][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
ROOT="/opt/${REPO_NAME}"

# 捕获现役容器的 PG 连接串（流量/日志入库靠它；丢 = 用量与日志历史静默失效）。
# 依次: 在跑容器 env → 旧 compose 文件 → 旧 .env。
PG_URL="$(docker exec clash-party printenv CP_DATABASE_URL 2>/dev/null || true)"
[ -z "$PG_URL" ] && PG_URL="$(sed -n 's/^\s*CP_DATABASE_URL:\s*//p' /opt/clash-party/docker-compose.yml 2>/dev/null | head -1 || true)"
[ -z "$PG_URL" ] && PG_URL="$(grep -h '^CP_DATABASE_URL=' /opt/clash-party/.env 2>/dev/null | head -1 | cut -d= -f2- || true)"

# override 只写 env（无 ports 段，bootstrap 不会清它；container_name 在仓库 compose 里）。
if [ -n "$PG_URL" ]; then
  cat > "$ROOT/deploy/party/docker-compose.override.yml" <<OVR
# 由 release.sh 自动生成（从旧部署捕获）——PostgreSQL 流量/日志入库连接串。
services:
  clash-party:
    environment:
      CP_DATABASE_URL: ${PG_URL}
OVR
  log "CP_DATABASE_URL 已写入 override"
else
  rm -f "$ROOT/deploy/party/docker-compose.override.yml"
  log "未检测到旧 CP_DATABASE_URL（全新机器）"
fi

# 摘旧容器（数据在 /var/lib/clash-party bind 卷，不丢；旧部署目录保留可回滚）。
if docker ps -a --format '{{.Names}}' | grep -qx 'clash-party'; then
  log "停并移除旧容器 clash-party"
  docker rm -f clash-party >/dev/null
fi
log "交接完成，启动 bootstrap"
REMOTE

SSH "REPO_NAME='${REPO_NAME}' \
     NPM_REGISTRY='${NPM_REGISTRY:-https://registry.npmmirror.com}' \
     GITHUB_MIRROR='${GITHUB_MIRROR:-}' \
     FORCE=true \
     bash '${REMOTE_ROOT}/deploy/opt/bootstrap.sh' '${HOST}'" \
  || fail "bootstrap.sh 失败（日志见上；回滚: ssh ${SSH_USER}@${HOST} 'cd /opt/clash-party && docker compose up -d --build'）"

# ------------------------------------------------ 5. 验证 + 汇总 ---
log "Stage 5/5: 部署验证"
DEPLOYED_VER="$(SSH "docker exec clash-party sed -n 's/.*\"version\": *\"\([^\"]*\)\".*/\1/p' /app/package.json 2>/dev/null | head -1" || true)"
PG_OK="$(SSH "docker exec clash-party printenv CP_DATABASE_URL >/dev/null 2>&1 && echo yes || echo no" || true)"
LOGS="$(SSH "docker logs --tail 6 clash-party 2>&1" || true)"
cat <<EOF

==================== 一键部署完成 ====================
服务器      : ${SSH_USER}@${HOST}
本地版本    : ${VERSION}
容器版本    : ${DEPLOYED_VER:-未知}
PG 入库     : ${PG_OK}（CP_DATABASE_URL）
Web UI      : http://${HOST}:3999/
代理口      : http://${HOST}:7890 (HTTP+SOCKS5)
数据目录    : /var/lib/clash-party（bind，重建不丢）
回滚        : ssh ${SSH_USER}@${HOST} 'cd /opt/clash-party && docker compose up -d --build'

最近日志:
${LOGS}
==================================================
EOF
if [ "$KEEP_TARBALL" != "true" ]; then
  SSH "rm -f '${REMOTE_TARBALL}'"
  log "已清理服务器 tar 包（KEEP_TARBALL=true 可保留）"
fi
