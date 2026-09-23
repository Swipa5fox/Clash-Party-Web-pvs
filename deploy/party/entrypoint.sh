#!/usr/bin/env bash
# cpx-party container entrypoint: seed the Clash Party controlled-mihomo config
# on first boot, then exec Electron in headless web mode.
#
# Seed rationale (defaults from src/main/utils/template.ts are LAN-unfriendly):
#   allow-lan: false            -> LAN clients could not use the proxy ports
#   external-controller: ''     -> no TCP API for the cpx-gateway to proxy
# The values below are written ONCE; afterwards they are user-owned and can be
# changed from the Web UI (设置 -> Mihomo 内核). Deleting the volume re-seeds.
set -euo pipefail

DATA_DIR="${HOME}/.config/mihomo-party-dev"
mkdir -p "$DATA_DIR"

# mihomo runs with `-d <dataDir>/work` (see src/main/utils/dirs.ts), so the
# `external-ui: ui` below resolves to work/ui. Seed the offline panel UI from
# the image (extra/panel-ui, part of the core-assets sync) on first boot only:
# with ui/ in place mihomo serves it immediately and never downloads from
# github.com at runtime. Without it, external-ui-url kicks in as fallback.
WORK_DIR="${DATA_DIR}/work"
PANEL_SRC="/app/extra/panel-ui"
if [ ! -d "${WORK_DIR}/ui" ] && [ -d "$PANEL_SRC" ] && [ -n "$(ls -A "$PANEL_SRC" 2>/dev/null)" ]; then
  mkdir -p "$WORK_DIR"
  cp -a "$PANEL_SRC/." "${WORK_DIR}/ui/"
  echo "[entrypoint] seeded offline panel UI -> ${WORK_DIR}/ui"
fi

if [ ! -f "${DATA_DIR}/mihomo.yaml" ]; then
  cat > "${DATA_DIR}/mihomo.yaml" <<'EOF'
# Seeded by the cpx-party container (first boot only). Editable in the Web UI.
mode: rule
log-level: info
ipv6: true
mixed-port: 7890
# LAN sharing: the whole point of this deployment.
allow-lan: true
bind-address: '*'
# TCP controller for the cpx-gateway reverse proxy. The compose stack runs
# network_mode: host, so 127.0.0.1 keeps the controller reachable by the
# gateway over localhost while staying invisible to LAN clients — they must
# use the gated panel on the gateway :8080. CP itself keeps talking to the
# core over its private unix socket regardless of this setting. Volumes
# seeded by older versions keep their old value; edit it in the Web UI.
external-controller: 127.0.0.1:9090
# Panel files served through the gateway at :8080/ui (zashboard, CP's default).
# ui/ is pre-seeded from the image when the offline panel ships; the URL stays
# as the mihomo-native update/refresh channel (used only when ui/ is deleted).
external-ui: ui
external-ui-url: https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip
EOF
  echo "[entrypoint] seeded ${DATA_DIR}/mihomo.yaml (allow-lan + controller 0.0.0.0:9090)"
fi

# Guard against CRLF checkouts breaking the shebang (same as deploy.sh).
if grep -q $'\r' "$0"; then
  echo "[entrypoint][FAIL] CRLF line endings — fix with: sed -i 's/\r\$//' entrypoint.sh" >&2
  exit 1
fi

if [ -z "${CP_WEB_TOKEN:-}" ]; then
  # Random per-boot token: the exact URL is printed in the container log.
  echo "[entrypoint] CP_WEB_TOKEN not set — a random token is generated per boot:"
  echo "[entrypoint]   docker logs <party-container> | grep 'Web UI'"
fi

exec xvfb-run -a \
  node_modules/.bin/electron . --web \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage
