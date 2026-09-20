#!/usr/bin/env bash
# bootstrap.sh — 在 /opt 下从零构筑 cpx-gateway + Clash Party Web UI。
#
# 服务器端用法(解压后执行):
#   bash /opt/clash-party-gateway/deploy/opt/bootstrap.sh 192.168.1.100
#
# 也可只传压缩包,脚本自己解压:
#   bash bootstrap.sh 192.168.1.100             # TARBALL 默认 /opt/cpx-src.tar.gz
#
# 环境变量:
#   TARBALL=/opt/cpx-src.tar.gz   源码包路径(仓库目录已存在时忽略)
#   OPT_ROOT=/opt                 解压根目录
#   CP_TOKEN=<令牌>               Web UI 令牌(不传则随机生成,并在部署结果里打印)
#   FORCE=true                    外网自检不通过时仍然继续构建
#
# 做四件事: 解压 → 预检(docker/外网) → 写 .env 与线路端口门 → deploy.sh 构建并启动。
set -euo pipefail

# 自愈 CRLF(从 Windows 传过来的包可能是 CRLF,shebang/行尾会炸)。
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0" && exec bash "$0" "$@"
fi

HOST_IP="${1:-${HOST_IP:-}}"
TARBALL="${TARBALL:-/opt/cpx-src.tar.gz}"
OPT_ROOT="${OPT_ROOT:-/opt}"
REPO_NAME="${REPO_NAME:-clash-party-gateway}"
# Web UI 令牌: 显式传入则使用;否则随机生成(仓库/源码里不留任何固定令牌)。
CP_TOKEN="${CP_TOKEN:-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
FORCE="${FORCE:-false}"
WEB_PORT="${PARTY_WEB_PORT:-3999}"

log()  { printf '\033[1;34m[boot]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[boot][warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[boot][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------ 1. 定位源码 ---
log "Stage 1/5: 定位源码"
ROOT="$OPT_ROOT/$REPO_NAME"
if [ ! -d "$ROOT/deploy/gateway" ]; then
  [ -f "$TARBALL" ] || fail "既没有已解压的 $ROOT,也找不到压缩包 $TARBALL"
  log "解压 $TARBALL -> $OPT_ROOT"
  tar -xzf "$TARBALL" -C "$OPT_ROOT"
fi
[ -d "$ROOT/deploy/gateway" ] || fail "包结构不符: 需存在 $ROOT/deploy/gateway"
[ -f "$ROOT/deploy/party/Dockerfile" ] || fail "包结构不符: 缺 deploy/party/Dockerfile"
log "仓库根: $ROOT"

# --------------------------------------------------------- 2. 主机 IP 探测 ---
if [ -z "$HOST_IP" ]; then
  HOST_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')" || true
fi
[ -n "$HOST_IP" ] || fail "无法探测本机 IP,请显式传入: bash $0 <IP>"
log "目标主机: $HOST_IP (PUBLIC_ORIGIN=http://${HOST_IP}:8080)"

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
# 探真正的资源地址(release 资产可能走独立 CDN);首页通但资产不通也会白等一场构建。
if http_alive https://github.com/ \
  || http_alive https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt; then
  log "  ✓ github.com 可达(mihomo 内核/geo 下载)"
else
  warn "✗ github.com 不可达 → scripts/prepare.mjs 无镜像开关,构建必失败;改走「镜像搬运」方案(见末尾)"
  NET_BAD=1
fi
http_alive https://registry.npmmirror.com/ \
  && log "  ✓ npmmirror 可达(pnpm 依赖)" \
  || { warn "✗ npmmirror 不可达 → 用 NPM_REGISTRY=<你的源> 重跑"; NET_BAD=1; }
if [ "$NET_BAD" != "0" ] && [ "$FORCE" != "true" ]; then
  fail "外网自检未通过。修好网络后重跑;确知能通可加 FORCE=true 强推。"
fi

# --------------------------------------------- 4. .env + 线路端口门(override) ---
log "Stage 3/5: 写 .env 与线路端口门"
cd "$ROOT/deploy/gateway"
if [ ! -f .env ]; then
  cp .env.example .env
  log "由 .env.example 生成 .env"
else
  warn ".env 已存在(非新建),将只覆盖 PUBLIC_ORIGIN 与 CP_WEB_TOKEN。当前生效项:"
  grep -vE '^[[:space:]]*(#|$)' .env | sed 's/^/      /'
fi
# 显式给定 PUBLIC_ORIGIN 与 CP_WEB_TOKEN,避免 deploy.sh 走交互/落回 change-me 默认值。
sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=http://${HOST_IP}:8080|" .env
if grep -q '^CP_WEB_TOKEN=' .env; then
  sed -i "s|^CP_WEB_TOKEN=.*|CP_WEB_TOKEN=${CP_TOKEN}|" .env
else
  printf '\nCP_WEB_TOKEN=%s\n' "$CP_TOKEN" >> .env
fi
log ".env 就绪 (PUBLIC_ORIGIN=http://${HOST_IP}:8080)"

# 线路端口门: docker-compose.yml 只映射了 AU 通用口 17890,其余三个口靠 override 补。
# 门与屋分离——覆写(屋)由 tools/mihomo-lines 的线路工具通过 WS 桥写入,端口映射(门)必须在 compose 层。
OVR="$ROOT/deploy/gateway/docker-compose.override.yml"
# 旧机上残留的 override 可能缺端口(或重复映射 17890 导致冲突),所以不能「存在就跳过」,
# 必须逐口校验;缺则备份后重写为规范版。
WRITE_OVR="false"
if [ ! -f "$OVR" ]; then
  WRITE_OVR="true"
else
  MISSING=""
  for p in 17891 8888 8889; do
    grep -q "${p}:${p}" "$OVR" || MISSING="$MISSING $p"
  done
  if [ -n "$MISSING" ]; then
    cp "$OVR" "${OVR}.bak-$(date +%Y%m%d-%H%M%S)"
    warn "旧 override 缺端口:$MISSING → 已备份原文件并重写规范版"
    WRITE_OVR="true"
  else
    log "override 已含 17891/8888/8889,保留"
  fi
  # 17890 在 docker-compose.yml 里已映射,override 再写一次会端口冲突。
  if grep -q "17890:17890" "$OVR"; then
    warn "override 里重复映射了 17890(与 docker-compose.yml 冲突),已移除该行"
    sed -i '/17890:17890/d' "$OVR"
  fi
fi
if [ "$WRITE_OVR" = "true" ]; then
  cat > "$OVR" <<'YML'
# 国家双口线路的端口映射(门)。17890 已在 docker-compose.yml 里,勿重复以免端口冲突。
# AU·全局 17891 / JP·通用 8888 / JP·全局 8889
services:
  party:
    ports:
      - '17891:17891'
      - '8888:8888'
      - '8889:8889'
YML
  log "已写 docker-compose.override.yml(17891/8888/8889)"
fi

# ------------------------------------------------ 5. 构建 + 启动 + 自检 ---
log "Stage 4/5: 构建并启动(首次 5-15 分钟,取决于外网拉取速度)"
GATEWAY_ADDR="${HOST_IP}:8080" ./deploy.sh

# 可选: 从旧服务器搬来的数据包,恢复到 party_data 卷(订阅/覆写/线路全在卷里)。
if [ -f "$OPT_ROOT/party_data.tgz" ]; then
  log "Stage 4.5/5: 检测到 $OPT_ROOT/party_data.tgz,恢复到 party_data 卷"
  VOL="$(docker volume ls -q | grep -m1 'party_data$' || true)"
  [ -n "$VOL" ] || fail "找不到 party_data 卷,跳过恢复"
  docker run --rm -v "$VOL":/data -v "$OPT_ROOT":/backup alpine \
    sh -c 'tar xzf /backup/party_data.tgz -C /data' \
    && docker compose restart party \
    && log "数据已恢复(订阅/覆写在卷内,无需重新添加)"
fi

# ------------------------------------------------------------- 6. 汇总 ---
log "Stage 5/5: 汇总"
TOKEN="$(grep -E '^CP_WEB_TOKEN=' .env | cut -d= -f2-)"
cat <<EOF

==================== 构筑完成 ====================
Web UI   : http://${HOST_IP}:${WEB_PORT}/?token=${TOKEN}
网关面板 : http://${HOST_IP}:8080/
代理口   : http://${HOST_IP}:7890 (HTTP+SOCKS5 混合口)
线路口   : 17890 AU·通用 / 17891 AU·全局 / 8888 JP·通用 / 8889 JP·全局
源码位置 : $ROOT

下一步(线路是「门+屋」两层,门已开,屋需写覆写):
  1) 浏览器打开上面的 Web UI,在「订阅」里添加订阅(全新盘需要重新加;搬迁盘已自带)
  2) 本地准备线路工具配置(工具在 tools/mihomo-lines/scripts/,存为同目录 lines.config.json):
       { "host": "${HOST_IP}", "token": "${TOKEN}" }
  3) 推送线路覆写(幂等; AU/JP 四口线路定义在 tools/mihomo-lines/scripts/overrides/):
       node lines.mjs push overrides/au-jp-lines.yaml au-jp-lines 'AU/JP 双口线路'
       node lines.mjs verify
  4) 出问题看日志: cd $ROOT/deploy/gateway && docker compose logs -f party

不用源码构建的备选(旧机还在时最快,零外网依赖):
  旧机: docker save cpx-party:local cpx-gateway:local | ssh 新机 'docker load'
        然后新机只跑本脚本的 Stage 3~4 前两步 + docker compose up -d
==================================================
EOF
