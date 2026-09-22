#!/usr/bin/env bash
# deploy.sh — build-from-source deployment for cpx-gateway + cpx-party (Clash Party Web UI).
#
# Stages:
#   1. Preflight  — docker / compose v2 present
#   2. Configure  — create .env on first run (interactive, or preset via env vars)
#   3. Build      — build both images from local source (explicit docker build)
#   4. Publish    — optional: tag for a private registry and push
#   5. Run        — docker compose up with the freshly built images
#   6. Verify     — health-check gateway well-known + party web UI + proxy port
#
# Usage:
#   ./deploy.sh [options]
#
# Options:
#   --tag TAG          image tag (default: local, plus "latest" alias)
#   --no-cache         pass --no-cache to docker build
#   --registry HOST    private registry host[:port]; images are tagged HOST/<name>:TAG
#   --push             push to the registry (requires --registry)
#   --services LIST    space-separated subset to deploy (default: "gateway party")
#   --env-only         stop after writing .env (no build / run)
#
# TUN transparent proxy (Linux hosts): not applicable to the party container
# (its core runs inside the container without NET_ADMIN).
#
# Non-interactive (CI) preset: set GATEWAY_ADDR env var before running, e.g.
#   GATEWAY_ADDR=192.168.1.100:8080 ./deploy.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------- options ---
GATEWAY_IMAGE_NAME="${GATEWAY_IMAGE_NAME:-cpx-gateway}"
PARTY_IMAGE_NAME="${PARTY_IMAGE_NAME:-cpx-party}"
IMAGE_TAG="${IMAGE_TAG:-local}"
REGISTRY="${REGISTRY:-}"
PUSH="false"
NO_CACHE=""
SERVICES=(gateway party)
ENV_ONLY="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) IMAGE_TAG="$2"; shift 2 ;;
    --no-cache) NO_CACHE="--no-cache"; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --push) PUSH="true"; shift ;;
    --services) read -ra SERVICES <<<"$2"; shift 2 ;;
    --env-only) ENV_ONLY="true"; shift ;;
    -h|--help) grep -E '^# (Usage|Options)|^#[[:space:]]+--[a-z]' "$SCRIPT_DIR/$(basename "$0")" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1 (use --help)" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------- 1. preflight ---
log "Stage 1/6: preflight"
command -v docker >/dev/null 2>&1 || fail "Docker is required. Install it, then re-run: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (the 'docker compose' subcommand)."
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable (is it started?)."
[ -f Dockerfile ] || fail "Dockerfile not found in $(pwd) — run this script from deploy/gateway."
# CRLF line endings break the shebang on Linux ("'bash\r': No such file or directory").
# The repo ships .gitattributes (*.sh eol=lf); this guards against a checkout that
# predates it or an editor that re-saved with CRLF.
if grep -q $'\r' "$0"; then
  fail "This script has CRLF line endings and cannot run on Linux. Fix with: sed -i 's/\r$//' deploy.sh (or re-checkout after the .gitattributes rule)."
fi
log "docker $(docker --version | cut -d, -f1) OK"

# -------------------------------------------------------- 2. configure ---
log "Stage 2/6: configure .env"
if [ ! -f .env ]; then
  cp .env.example .env
  ADDR="${GATEWAY_ADDR:-}"
  if [ -z "$ADDR" ]; then
    read -rp "Gateway address (IP:port reachable by LAN clients), e.g. 192.168.1.100:8080: " ADDR
  fi
  # Sanitize: users paste with markdown backticks / quotes / trailing slash, all of
  # which corrupt PUBLIC_ORIGIN (it must be the exact origin clients will use).
  # tr uses octal escapes (\140=` \042=" \047=') so no quote chars appear in source.
  ADDR="$(printf '%s' "$ADDR" | tr -d '\140\042\047[:space:]' | sed 's:/*$::')"
  # Accept both "IP:port" and a full "http://IP:port" origin; must contain a port.
  case "$ADDR" in
    *:*) ADDR="${ADDR#http://}" ;;
    *) fail "Address must be IP:port (e.g. 192.168.1.100:8080). Got: ${ADDR:-<empty>}" ;;
  esac
  sed -i.bak "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=http://${ADDR}|" .env && rm -f .env.bak
  log "Wrote .env (PUBLIC_ORIGIN=http://${ADDR})"
else
  log ".env exists — keeping it (delete the file to reconfigure)."
fi
# CP_WEB_TOKEN gates the Clash Party Web UI (:3999). Generate a random one when
# missing (first run or upgrade from an older .env) so compose can start.
# The value itself stays out of this log — it is shown once in the final summary,
# and only when stdout is a terminal.
if ! grep -q '^CP_WEB_TOKEN=' .env; then
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf '\nCP_WEB_TOKEN=%s\n' "$TOKEN" >> .env
  chmod 600 .env 2>/dev/null || true
  log "Generated CP_WEB_TOKEN (Web UI auth) — stored in .env, shown in the final summary."
fi
# PANEL_TOKEN gates the proxied mihomo control API on :8080 (single-port panel).
# Without it any LAN host controls the core, so fresh deploys get one too.
# An existing .env is left alone: set PANEL_TOKEN= there to disable, or a value to enable.
if ! grep -q '^PANEL_TOKEN=' .env; then
  printf '\nPANEL_TOKEN=%s\n' "$TOKEN" >> .env
  log "Generated PANEL_TOKEN (panel/API auth on :8080) — same value as CP_WEB_TOKEN."
fi
# shellcheck disable=SC1091
. ./.env   # pulls in MIHOMO_*_PORT overrides for the verify stage
if [ "$ENV_ONLY" = "true" ]; then
  log "--env-only: stopping after configuration."
  exit 0
fi

# True when $1 is listed in --services.
want() {
  local s
  for s in "${SERVICES[@]}"; do
    [ "$s" = "$1" ] && return 0
  done
  return 1
}

# ------------------------------------------------------------- 3. build ---
# Build both images with explicit docker build (compose only references them by
# tag, so builds are fully owned by this script — never silently rebuilt).
if want gateway; then
  log "Stage 3/6: build ${GATEWAY_IMAGE_NAME}:${IMAGE_TAG} from source"
  docker build $NO_CACHE \
    -t "${GATEWAY_IMAGE_NAME}:${IMAGE_TAG}" \
    -t "${GATEWAY_IMAGE_NAME}:latest" \
    -f Dockerfile .
  log "Built ${GATEWAY_IMAGE_NAME}:${IMAGE_TAG} (alias ${GATEWAY_IMAGE_NAME}:latest)"
else
  log "Stage 3/6: gateway build skipped (not in --services)"
fi
if want party; then
  log "Stage 3/6: build ${PARTY_IMAGE_NAME}:${IMAGE_TAG} from repo root"
  # Context is the REPOSITORY ROOT (the app needs src/, scripts/, package.json).
  # -f must be absolute: BuildKit resolves a relative -f against the context,
  # not the CWD ("lstat deploy: no such file or directory").
  # NPM_REGISTRY defaults to a mirror — registry.npmjs.org is unreachable at
  # usable speeds from CN networks (override with the env var if needed).
  NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
  docker build $NO_CACHE \
    --build-arg NPM_REGISTRY="${NPM_REGISTRY}" \
    -t "${PARTY_IMAGE_NAME}:${IMAGE_TAG}" \
    -t "${PARTY_IMAGE_NAME}:latest" \
    -f "$REPO_ROOT/deploy/party/Dockerfile" "$REPO_ROOT"
  log "Built ${PARTY_IMAGE_NAME}:${IMAGE_TAG} (alias ${PARTY_IMAGE_NAME}:latest)"
else
  log "Stage 3/6: party build skipped (not in --services)"
fi

# ----------------------------------------------------------- 4. publish ---
if [ -n "$REGISTRY" ]; then
  log "Stage 4/6: publish to ${REGISTRY}"
  for name in ""; do :; done
  for image in "$GATEWAY_IMAGE_NAME" "$PARTY_IMAGE_NAME"; do
    docker tag "${image}:${IMAGE_TAG}" "${REGISTRY}/${image}:${IMAGE_TAG}"
    if [ "$PUSH" = "true" ]; then
      docker push "${REGISTRY}/${image}:${IMAGE_TAG}"
      log "Pushed ${REGISTRY}/${image}:${IMAGE_TAG}"
    else
      log "Tagged ${REGISTRY}/${image}:${IMAGE_TAG} (--push not set, skip push)"
    fi
  done
else
  log "Stage 4/6: publish skipped (no --registry)"
fi

# --------------------------------------------------------------- 5. run ---
log "Stage 5/6: docker compose up (${SERVICES[*]})"
export GATEWAY_IMAGE="${GATEWAY_IMAGE_NAME}:${IMAGE_TAG}"
export PARTY_IMAGE="${PARTY_IMAGE_NAME}:${IMAGE_TAG}"
# 上一次 compose up 若被中断(构建失败/网络抖动/Ctrl-C),会留下一个被重命名成
# "<旧容器ID>_<服务名>"、状态为 Created 的搁浅容器,占着服务名不放 → 本次 up 直接报
# Conflict 且【静默不重建】:镜像明明构建成功了,实际跑的还是旧镜像,极易误判为部署成功。
# 状态为 Created 的容器是"建了从没启动过"的纯垃圾(正常停止是 Exited),清掉无风险。
STRANDED="$(docker ps -aq --filter status=created)"
if [ -n "$STRANDED" ]; then
  log "清理搁浅容器(上次 up 中断的残留): $(docker ps -a --filter status=created --format '{{.Names}}' | tr '\n' ' ')"
  echo "$STRANDED" | xargs -r docker rm -f >/dev/null
fi
docker compose up -d "${SERVICES[@]}"

# ------------------------------------------------------------ 6. verify ---
log "Stage 6/6: health check"
# Port discovery: `docker compose port` prints nothing under network_mode: host
# (used by the TUN overlay docker-compose.tun.yml) — the container then listens
# directly on the host port, so fall back to it.
GATEWAY_HOST_PORT="$(docker compose port gateway 8080 2>/dev/null | sed 's/.*://' || true)"
if [ -z "$GATEWAY_HOST_PORT" ] && want gateway; then
  GATEWAY_HOST_PORT=8080
  log "host-network mode detected — probing gateway directly on :8080"
fi
# `docker compose up` returns as soon as the CONTAINER is started, not when the
# process inside has bound its port — curl fired immediately loses the race
# (Recv failure / Connection reset). Retry for up to VERIFY_WAIT_S seconds.
# Generous default: the party container cold-boots Electron + its mihomo core.
VERIFY_WAIT_S="${VERIFY_WAIT_S:-45}"
# --noproxy '*': hosts with a global http_proxy set would route even the loopback
# health check through the proxy.
wait_http() { # url [grep-pattern]
  local url="$1" pattern="${2:-}" i body
  for ((i = 1; i <= VERIFY_WAIT_S; i++)); do
    if body="$(curl -fsS --noproxy '*' --max-time 3 "$url" 2>/dev/null)"; then
      if [ -z "$pattern" ] || printf '%s' "$body" | grep -q "$pattern"; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}
wait_tcp() { # port
  local i port="$1"
  for ((i = 1; i <= VERIFY_WAIT_S; i++)); do
    if (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
verify_gateway() {
  want gateway || return 0
  [ -n "$GATEWAY_HOST_PORT" ] || { echo "  gateway: not running (docker compose port empty)"; return 1; }
  if wait_http "http://127.0.0.1:${GATEWAY_HOST_PORT}/.well-known/cpx-gateway"; then
    echo "  gateway: OK (well-known reachable on host :${GATEWAY_HOST_PORT})"
    return 0
  fi
  echo "  gateway: FAIL (well-known not reachable on :${GATEWAY_HOST_PORT}) — see: docker compose logs gateway"
  return 1
}
# Party container: headless Electron serving the full Web UI (:3999) + its own
# mihomo core (mixed port).
verify_party() {
  want party || return 0
  local rc=0 web_port="${PARTY_WEB_PORT:-3999}"
  if wait_http "http://127.0.0.1:${web_port}/"; then
    echo "  party:   OK (Web UI reachable on host :${web_port})"
  else
    echo "  party:   FAIL (Web UI not reachable on :${web_port}) — see: docker compose logs party"
    rc=1
  fi
  local port="${MIHOMO_MIXED_PORT:-7890}"
  if wait_tcp "$port"; then
    echo "  proxy:   OK (mixed port listening on host :${port})"
  else
    echo "  proxy:   FAIL (nothing listening on :${port}) — see: docker compose logs party"
    rc=1
  fi
  return $rc
}
# Panel + proxied controller API, both served by the gateway on its single port.
# The upstream is the party container's mihomo controller (compose network).
verify_panel() {
  want gateway && want party || return 0
  [ -n "$GATEWAY_HOST_PORT" ] || return 0
  if wait_http "http://127.0.0.1:${GATEWAY_HOST_PORT}/version" '"meta"'; then
    echo "  panel:   OK (controller API proxied on gateway :${GATEWAY_HOST_PORT}, open http://<host>:${GATEWAY_HOST_PORT}/)"
    return 0
  fi
  echo "  panel:   FAIL (/version not proxied) — see: docker compose logs gateway party"
  return 1
}
RC=0
verify_gateway || RC=1
verify_party   || RC=1
verify_panel   || RC=1
[ "$RC" -eq 0 ] || fail "Health check failed for one or more services."

ORIGIN="$(grep -E '^PUBLIC_ORIGIN=' .env | cut -d= -f2-)"
TOKEN="$(grep -E '^CP_WEB_TOKEN=' .env | cut -d= -f2-)"
HOST_IP="${ORIGIN#http://}"; HOST_IP="${HOST_IP%%:*}"
# CP_WEB_TOKEN grants full control of the Clash Party instance, so never let it
# land in captured output (CI logs, `./deploy.sh > deploy.log`). An interactive
# operator gets the ready-to-click URL; a non-TTY run gets a pointer to .env.
if [ -t 1 ]; then
  WEB_URL="http://${HOST_IP}:${PARTY_WEB_PORT:-3999}/?token=${TOKEN}"
else
  WEB_URL="http://${HOST_IP}:${PARTY_WEB_PORT:-3999}/?token=<CP_WEB_TOKEN, see .env>"
fi
cat <<EOF

✅ Deployed ${GATEWAY_IMAGE_NAME}:${IMAGE_TAG} + ${PARTY_IMAGE_NAME}:${IMAGE_TAG}
   PUBLIC_ORIGIN=${ORIGIN}

Next steps:
  1) Clash Party Web UI (full interface): open
       ${WEB_URL}
     Add your subscription under 订阅 (Profiles) — the party container's mihomo
     core picks it up automatically (no file editing, no restart).
  2) LAN clients use http://${HOST_IP}:${MIHOMO_MIXED_PORT:-7890} (HTTP+SOCKS5 mixed)
  3) Control panel via the gateway: open ${ORIGIN}/ — it asks for PANEL_TOKEN once
     per browser (same value as the Web UI token above; see .env)
  4) Verify discovery:      curl ${ORIGIN}/.well-known/cpx-gateway
  5) Add a gateway account (prompts for a password):
       docker compose exec gateway cpx-admin add-user <name> '<hidden-subscription-url>' --limit 3
  6) 国家双口线路(AU/JP,可选;先完成第 1 步的订阅): 用 skill,不在本目录跑脚本 ——
       cd <repo>/tools/mihomo-lines/scripts
       node lines.mjs add AU 17890 '澳洲|Australia|Sydney|悉尼|🇦🇺'
       node lines.mjs add JP 8888  '日本|Japan|Tokyo|东京|大阪|🇯🇵'
       node lines.mjs verify

Manage:  docker compose exec gateway cpx-admin list-users
Logs:    docker compose logs -f gateway party
Update:  ./deploy.sh                 (rebuild from latest source; data persists in volumes)
Rebuild from scratch:  ./deploy.sh --no-cache --tag local
Private registry:      ./deploy.sh --registry reg.local:5000 --push
EOF
