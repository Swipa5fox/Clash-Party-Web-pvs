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
# TCP controller for the cpx-gateway reverse proxy. Only reachable inside the
# compose network (the port is not published to the host). CP itself keeps
# talking to the core over its private unix socket regardless of this setting.
external-controller: 0.0.0.0:9090
# Panel files served through the gateway at :8080/ui (zashboard, CP's default).
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
