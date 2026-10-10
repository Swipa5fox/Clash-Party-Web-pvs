#!/usr/bin/env bash
# clash-party container entrypoint: seed the controlled-mihomo config on first
# boot, then exec the pure-Node server (v1.3+: no Electron, no xvfb).
#
# Seed rationale (defaults from src/main/utils/template.ts are LAN-unfriendly):
#   allow-lan: false            -> LAN clients could not use the proxy ports
#   external-controller: ''     -> no TCP API for out-of-band raw REST
# The values below are written ONCE; afterwards they are user-owned and can be
# changed from the Web UI (设置 -> Mihomo 内核). Deleting the volume re-seeds.
set -euo pipefail

# 数据目录由 CP_DATA_DIR 决定（compose 里是 /data）。v1.3 纯 Node 版数据直落
# 该目录本身（config.yaml / mihomo.yaml / profiles / web-auth.json / logs），
# 不再像 Electron 时代那样套 .config/mihomo-party-dev 一层。
DATA_DIR="${CP_DATA_DIR}"
mkdir -p "$DATA_DIR"

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
# to LAN clients. Kept as an out-of-band escape hatch for raw REST (curl
# 127.0.0.1:9090) if the Node server ever dies — the everyday admin surface is the
# Web UI on :3999. CP itself keeps talking to the core over its private unix
# socket regardless of this setting. Volumes seeded by older versions keep their
# old value; edit it in the Web UI.
external-controller: 127.0.0.1:9090
EOF
  echo "[entrypoint] seeded ${DATA_DIR}/mihomo.yaml (allow-lan + controller 127.0.0.1:9090)"
fi

# 纯 Node 服务器：node 是 PID 1 语义下的唯一进程（compose init:true 时为 tini 的
# 子进程），自己管理 mihomo sidecar 子进程的启停。
exec node server.cjs
