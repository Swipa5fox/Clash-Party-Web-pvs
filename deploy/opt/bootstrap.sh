#!/usr/bin/env bash
# bootstrap.sh — 在 /opt 下从零构筑 Clash Party Web（单容器：纯 Node 服务器 + 自带 mihomo 内核）。
#
# 服务器端用法(解压后执行):
#   bash /opt/Clash-Party-Web-pvs-1.0/deploy/opt/bootstrap.sh 192.168.1.100
#
# 也可只传压缩包,脚本自己解压:
#   bash bootstrap.sh 192.168.1.100             # TARBALL 默认 /opt/cpx-src.tar.gz
#
# 环境变量:
#   TARBALL=/opt/cpx-src.tar.gz   源码包路径(仓库目录已存在时忽略)
#   OPT_ROOT=/opt                 解压根目录
#   NPM_REGISTRY                  构建期 npm 源(默认 https://registry.npmmirror.com)
#   GITHUB_MIRROR                 构建期 GitHub 前缀(无预置内核资源时用,如 https://gh-proxy.com/)
#   CORE_ASSETS_DIR               预置内核/geo 资源目录(默认 /opt/cpx-core-assets)
#   FORCE=true                    外网自检不通过时仍然继续构建
#
# Web UI 鉴权是账号密码(v1.3+): 初始 admin/admin123, 首次登录后在 UI 改密。
#
# 做四件事: 解压 → 预检(docker/外网) → 构建镜像 → compose 启动并验证。
set -euo pipefail

# 自愈 CRLF(从 Windows 传过来的包可能是 CRLF,shebang/行尾会炸)。
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0" && exec bash "$0" "$@"
fi

HOST_IP="${1:-${HOST_IP:-}}"
TARBALL="${TARBALL:-/opt/cpx-src.tar.gz}"
OPT_ROOT="${OPT_ROOT:-/opt}"
REPO_NAME="${REPO_NAME:-Clash-Party-Web-pvs-1.0}"
FORCE="${FORCE:-false}"
# 需与容器内实际监听一致：compose 未导出 CP_WEB_PORT 时即应用默认 3999。
WEB_PORT="${PARTY_WEB_PORT:-3999}"
PROXY_PORT="${MIHOMO_MIXED_PORT:-7890}"
DATA_DIR="${CP_DATA_DIR:-/var/lib/clash-party}"

log()  { printf '\033[1;34m[boot]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[boot][warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[boot][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------ 1. 定位源码 ---
log "Stage 1/5: 定位源码"
ROOT="$OPT_ROOT/$REPO_NAME"
if [ ! -d "$ROOT/deploy/party" ]; then
  [ -f "$TARBALL" ] || fail "既没有已解压的 $ROOT,也找不到压缩包 $TARBALL"
  log "解压 $TARBALL -> $OPT_ROOT"
  tar -xzf "$TARBALL" -C "$OPT_ROOT"
fi
[ -f "$ROOT/deploy/party/Dockerfile" ] || fail "包结构不符: 缺 $ROOT/deploy/party/Dockerfile"
[ -f "$ROOT/deploy/party/docker-compose.yml" ] || fail "包结构不符: 缺 $ROOT/deploy/party/docker-compose.yml"
log "仓库根: $ROOT"

# --------------------------------------------------------- 2. 主机 IP 探测 ---
if [ -z "$HOST_IP" ]; then
  HOST_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')" || true
fi
[ -n "$HOST_IP" ] || fail "无法探测本机 IP,请显式传入: bash $0 <IP>"
log "目标主机: $HOST_IP"

# ------------------------------------------------------------- 3. 预检 ---
log "Stage 2/5: 预检"
command -v docker >/dev/null 2>&1 || fail "未装 Docker。装: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "缺 Docker Compose v2 插件(需要 'docker compose' 子命令)"
docker info >/dev/null 2>&1 || fail "Docker 守护进程不可达: systemctl enable --now docker"

# 主机时区对齐国内: 容器时区由 compose 的 TZ 指定,但主机日志/备份文件时间也应对齐。
if command -v timedatectl >/dev/null 2>&1; then
  cur="$(timedatectl show -p Timezone --value 2>/dev/null || echo '?')"
  if [ "$cur" != "Asia/Shanghai" ]; then
    timedatectl set-timezone Asia/Shanghai && log "  时区 $cur -> Asia/Shanghai" || warn "  ✗ 时区设置失败"
  else
    log "  时区已是 Asia/Shanghai"
  fi
else
  warn "  无 timedatectl,跳过主机时区设置(容器时区由 compose TZ 保证)"
fi

# 外网自检: 构建期三处依赖,任一不通都会在 10 分钟后才失败,提前告知。
# 注意 registry-1.docker.io 的 /v2/ 会返回 401,只要拿到「任何 HTTP 状态码」就算通。
http_alive() {
  local code
  code="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000)"
  [ "$code" != "000" ]
}
NET_BAD=0
# 已配 registry-mirrors 的机器直连 Docker Hub 通常仍是断的,别误判——直接看 daemon.json。
if grep -qs 'registry-mirrors' /etc/docker/daemon.json; then
  log "  ✓ Docker 已配 registry-mirrors,跳过 Docker Hub 直连探测"
elif http_alive https://registry-1.docker.io/v2/; then
  log "  ✓ Docker Hub 可达(基础镜像 node:22-slim)"
else
  warn "✗ Docker Hub 不可达 → 在 /etc/docker/daemon.json 加 registry-mirrors 后 systemctl restart docker"
  NET_BAD=1
fi
# 内核/geo 资源: 已固化在 $CORE_ASSETS_DIR(deploy 阶段同步进构建上下文)时,
# 构建完全不碰 GitHub;否则回退 scripts/prepare.mjs 联网下载 —— 那时 github
# 不通会拖垮整个构建,提前拦截。
CORE_ASSETS_DIR="${CORE_ASSETS_DIR:-/opt/cpx-core-assets}"
if [ -f "$CORE_ASSETS_DIR/extra/sidecar/mihomo" ]; then
  log "  ✓ 预置内核资源就绪 (${CORE_ASSETS_DIR}),构建不依赖 GitHub"
  if [ -d "$CORE_ASSETS_DIR/extra/panel-ui" ] && [ -n "$(ls -A "$CORE_ASSETS_DIR/extra/panel-ui" 2>/dev/null)" ]; then
    log "  ✓ 离线面板(zashboard)就绪(仅 ssh 隧道应急访问,不对 LAN 开放)"
  fi
elif [ -n "${GITHUB_MIRROR:-}" ] && http_alive "${GITHUB_MIRROR%/}/https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt"; then
  log "  ✓ 无预置内核资源,GITHUB_MIRROR 可达(${GITHUB_MIRROR})→ 构建走镜像下载"
elif http_alive https://github.com/ \
  || http_alive https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt; then
  log "  ✓ github.com 可达(mihomo 内核/geo 下载)"
else
  warn "✗ 无预置内核资源且 github.com 不可达 → 两个办法:"
  warn "    1) 把旧机的 /opt/cpx-core-assets 拷来(最快, 零外网依赖)"
  warn "    2) GITHUB_MIRROR=https://gh-proxy.com/ 重跑本脚本(构建走 GitHub 镜像)"
  NET_BAD=1
fi
http_alive https://registry.npmmirror.com/ \
  && log "  ✓ npmmirror 可达(pnpm 依赖镜像)" \
  || { warn "✗ npmmirror 不可达 → 用 NPM_REGISTRY=<你的源> 重跑"; NET_BAD=1; }
if [ "$NET_BAD" != "0" ] && [ "$FORCE" != "true" ]; then
  fail "外网自检未通过。修好网络后重跑;确知能通可加 FORCE=true 强推。"
fi

# ------------------------------------------------------- 4. 构建 party 镜像 ---
log "Stage 3/5: 构建镜像 clash-party:latest(首次 5-15 分钟,取决于外网拉取速度)"
# 默认 tag = package.json 版本号(可追溯/可回滚),并打 latest 别名(compose 引用它)。
# 解析不依赖 node(部署机可能只装了 docker)。
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
[ -n "$VERSION" ] || VERSION=local
# 内核/geo 资源离线化: 预置目录(CORE_ASSETS_DIR)按 extra/ 布局同步进构建上下文,
# Dockerfile 检测到 Linux 内核即跳过 scripts/prepare.mjs 的联网下载。
# 目录不存在时静默跳过, Dockerfile 自动回退联网下载(旧行为)。
if [ -d "$CORE_ASSETS_DIR/extra" ]; then
  log "同步预置内核资源 ${CORE_ASSETS_DIR} -> extra/(构建不碰 GitHub)"
  mkdir -p "$ROOT/extra"
  cp -au "$CORE_ASSETS_DIR/extra/." "$ROOT/extra/"
fi
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
# 构建上下文是仓库根(应用需要 src/ scripts/ package.json); -f 必须绝对路径
# (BuildKit 把相对 -f 当成对 context 解析)。
docker build \
  --build-arg NPM_REGISTRY="${NPM_REGISTRY}" \
  --build-arg GITHUB_MIRROR="${GITHUB_MIRROR:-}" \
  -t "clash-party:${VERSION}" \
  -t clash-party:latest \
  -f "$ROOT/deploy/party/Dockerfile" "$ROOT"
log "镜像就绪: clash-party:${VERSION}(别名 clash-party:latest)"

# ------------------------------------------------- 5. compose 启动 + 验证 ---
log "Stage 4/5: compose 启动"
mkdir -p "$DATA_DIR"
cd "$ROOT/deploy/party"
# 旧机残留的 override 若含 ports 段,会与 network_mode: host 冲突(compose 报错),
# 备份后删除。host 模式下所有端口(Web UI/代理/自定义线路口)直接绑宿主机。
OVR="docker-compose.override.yml"
if [ -f "$OVR" ] && grep -qE '^ *ports:' "$OVR"; then
  cp "$OVR" "${OVR}.bak-$(date +%Y%m%d-%H%M%S)"
  rm -f "$OVR"
  warn "旧 override 含 ports 段(与 network_mode: host 冲突),已备份为 .bak 并删除"
fi
# 上一次 compose up 若被中断(构建失败/网络抖动/Ctrl-C),会留下被重命名成
# "<旧容器ID>_<服务名>"、状态 Created 的搁浅容器,占着服务名不放 → 本次 up 报
# Conflict 且静默不重建:镜像明明换新了,实际跑的还是旧镜像,极易误判为部署成功。
STRANDED="$(docker ps -aq --filter status=created)"
if [ -n "$STRANDED" ]; then
  log "清理搁浅容器(上次 up 中断的残留): $(docker ps -a --filter status=created --format '{{.Names}}' | tr '\n' ' ')"
  echo "$STRANDED" | xargs -r docker rm -f >/dev/null
fi
docker compose up -d

# 可选: 从旧机搬来的数据包, 恢复到数据目录(订阅/覆写/凭据全在 /data 里)。
if [ -f "$OPT_ROOT/party_data.tgz" ]; then
  log "Stage 4.5/5: 检测到 $OPT_ROOT/party_data.tgz,恢复到 $DATA_DIR"
  tar xzf "$OPT_ROOT/party_data.tgz" -C "$DATA_DIR" \
    && docker compose restart clash-party \
    && log "数据已恢复(订阅/覆写在数据目录内,无需重新添加)"
fi

log "Stage 5/5: 健康检查"
# `docker compose up` 返回时容器进程可能还没绑上端口,curl 立即发会输掉竞态。
VERIFY_WAIT_S="${VERIFY_WAIT_S:-60}"
wait_http() { # url
  local i
  for ((i = 1; i <= VERIFY_WAIT_S; i++)); do
    if curl -fsS --noproxy '*' --max-time 3 "$1" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
wait_tcp() { # port
  local i
  for ((i = 1; i <= VERIFY_WAIT_S; i++)); do
    if (echo >"/dev/tcp/127.0.0.1/${1}") >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
RC=0
# v1.3+ 鉴权是账号密码登录: 未登录 `GET /` 是 302 → /login。探公开页 /login
# (200 即服务活着); curl -fsS 对 302 会按失败处理,不能直接探 /。
if wait_http "http://127.0.0.1:${WEB_PORT}/login"; then
  echo "  web:   OK (Web UI on host :${WEB_PORT})"
else
  echo "  web:   FAIL (Web UI not reachable on :${WEB_PORT})"
  RC=1
fi
if wait_tcp "$PROXY_PORT"; then
  echo "  proxy: OK (mixed port listening on host :${PROXY_PORT})"
else
  echo "  proxy: FAIL (nothing listening on :${PROXY_PORT})"
  RC=1
fi
[ "$RC" -eq 0 ] || fail "健康检查未通过。看日志: cd $ROOT/deploy/party && docker compose logs -f"

# ------------------------------------------------------------- 6. 汇总 ---
cat <<EOF

==================== 构筑完成 ====================
Web UI   : http://${HOST_IP}:${WEB_PORT}/  (账号密码登录, 初始 admin/admin123, 首次登录后改密)
代理口   : http://${HOST_IP}:${PROXY_PORT} (HTTP+SOCKS5 混合口)
线路口   : host 模式即写即生效(Web UI「代理组」页自定义线路组,或全局覆写 listeners)
数据目录 : ${DATA_DIR}  (订阅/覆写/凭据/日志,容器重建不丢)
管理口   : mihomo 控制器仅绑 127.0.0.1:9090,不对 LAN 暴露;应急面板走 ssh -L 9090:127.0.0.1:9090 隧道
源码位置 : $ROOT

下一步:
  1) 浏览器打开 Web UI,admin 登录并改密,在「订阅」里添加订阅(全新盘需要重新加;搬迁盘已自带)
  2) 出问题看日志: cd $ROOT/deploy/party && docker compose logs -f
  3) 国家双口线路(AU/JP,可选;先完成第 1 步的订阅):
       cd $ROOT/tools/mihomo-lines/scripts
       node lines.mjs add AU 17890 '澳洲|Australia|Sydney|悉尼|🇦🇺'
       node lines.mjs add JP 8888  '日本|Japan|Tokyo|东京|大阪|🇯🇵'
       node lines.mjs verify

更新: 源码更新后重跑本脚本(或只重建镜像后 docker compose up -d),数据全在 ${DATA_DIR} 不丢
不用源码构建的备选(旧机还在时最快,零外网依赖):
  旧机: docker save clash-party:latest | ssh 新机 'docker load'
        然后新机执行本脚本 Stage 4 的 compose up -d
==================================================
EOF
