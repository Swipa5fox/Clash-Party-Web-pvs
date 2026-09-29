#!/usr/bin/env bash
# clash-party container entrypoint: seed the controlled-mihomo config on first
# boot, then exec the pure-Node server (v1.3+: no Electron, no xvfb).
#
# Seed rationale (defaults from src/main/utils/template.ts are LAN-unfriendly):
#   allow-lan: false            -> LAN clients could not use the proxy ports
#   external-controller: ''     -> no TCP API for the out-of-band panel / raw REST
# The values below are written ONCE; afterwards they are user-owned and can be
# changed from the Web UI (设置 -> Mihomo 内核). Deleting the volume re-seeds.
set -euo pipefail

# 数据目录由 CP_DATA_DIR 决定（compose 里是 /data）。v1.3 纯 Node 版数据直落
# 该目录本身（config.yaml / mihomo.yaml / profiles / web-auth.json / logs），
# 不再像 Electron 时代那样套 .config/mihomo-party-dev 一层。
DATA_DIR="${CP_DATA_DIR}"
mkdir -p "$DATA_DIR"

# mihomo 以 `-d <dataDir>/work` 跑（见 src/main/utils/dirs.ts），所以下面的
# `external-ui: ui` 解析为 work/ui。镜像带了离线面板（zashboard，core-assets
# 流程放进 extra/panel-ui → 镜像内 /app/resources/panel-ui）时首启落位：
# ui/ 在位内核立即服务面板，不再从 github.com 下载。没有它则由内核首启按
# external-ui-url 兜底联网下载。
WORK_DIR="${DATA_DIR}/work"
PANEL_SRC="/app/resources/panel-ui"
if [ ! -d "${WORK_DIR}/ui" ] && [ -d "$PANEL_SRC" ] && [ -n "$(ls -A "$PANEL_SRC" 2>/dev/null)" ]; then
  mkdir -p "$WORK_DIR"
  cp -a "$PANEL_SRC/." "${WORK_DIR}/ui/"
  echo "[entrypoint] seeded offline panel UI -> ${WORK_DIR}/ui"
fi

if [ ! -f "${DATA_DIR}/mihomo.yaml" ]; then
  cat > "${DATA_DIR}/mihomo.yaml" <<'EOF'
# Seeded by the clash-party container (first boot only). Editable in the Web UI.
mode: rule
log-level: info
ipv6: true
mixed-port: 7890
# LAN sharing: the whole point of this deployment.
allow-lan: true
bind-address: '*'
# TCP controller bound to loopback only: reachable from the host itself, invisible
# to LAN clients. Kept as an out-of-band management path (zashboard panel via
# `ssh -L 9090:127.0.0.1:9090`, raw REST for debugging) — the everyday admin
# surface is the Web UI on :3999. CP itself keeps talking to the core over its
# private unix socket regardless of this setting. Volumes seeded by older
# versions keep their old value; edit it in the Web UI.
external-controller: 127.0.0.1:9090
# Zashboard files (CP's default external panel) served by the core at /ui on the
# loopback controller. ui/ is fetched by the core on first start when absent
# (GitHub); to run fully offline, pre-copy the panel into work/ui/ on the volume.
external-ui: ui
external-ui-url: https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip
EOF
  echo "[entrypoint] seeded ${DATA_DIR}/mihomo.yaml (allow-lan + controller 127.0.0.1:9090)"
fi

# 纯 Node 服务器：node 是 PID 1 语义下的唯一进程（compose init:true 时为 tini 的
# 子进程），自己管理 mihomo sidecar 子进程的启停。
exec node server.cjs
