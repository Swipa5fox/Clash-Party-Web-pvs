# cpx-party — Clash Party full Web UI in a container.
#
# Runs the app in its official headless web mode (CP_WEB_MODE=1 / --web):
# no window, no tray — the Electron main process serves out/renderer/web.html
# plus the WS RPC bridge on :3999 and manages its own mihomo sidecar core.
#
# Build context: REPOSITORY ROOT (not this directory):
#   docker build -t cpx-party:local -f deploy/party/Dockerfile .
#
# Container-side fixed ports:
#   3999 web UI (CP_WEB_PORT)   7890 mihomo mixed proxy (HTTP+SOCKS5)   9090 controller
# 9090 is NOT published to the host — the cpx-gateway proxies it (compose only).

# ------------------------------------------------------------------ builder --
FROM node:22-slim AS builder

# npm registry override (deploy.sh defaults to a mirror for CN networks);
# also used by corepack to fetch the pnpm binary itself.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}

WORKDIR /src

# corepack reads "packageManager": pnpm@x from package.json.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/native/sysproxy ./src/native/sysproxy

# "file:src\native\sysproxy" (windows backslashes) is not a valid path on linux —
# normalize it before install. The lockfile resolution already uses forward
# slashes, so pnpm reuses it (--no-frozen-lockfile just tolerates the specifier
# diff; nothing gets re-resolved from the registry).
# The "prepare" lifecycle script is dropped: it runs scripts/… which is not
# copied yet at install time (chicken-and-egg); prepare.mjs runs explicitly
# below instead. postinstall (electron download + install-app-deps) is kept.
RUN sed -i -e 's|file:src..native..sysproxy|file:src/native/sysproxy|' \
           -e '/"prepare":/d' package.json \
    && pnpm install --no-frozen-lockfile --registry="${NPM_REGISTRY}"

COPY . .

# Core assets: mihomo sidecar x3 + sysproxy .node + geo data. Two sources:
#   1. Pre-synced by deploy.sh from /opt/cpx-core-assets (extracted from an
#      already-built image) — the build then never touches github.com.
#   2. Fallback: scripts/prepare.mjs downloads them (requires github.com).
# Vendored files may arrive without exec bits (Windows checkout / tar), so the
# chmod is not optional.
RUN if [ -f extra/sidecar/mihomo ] && [ -f extra/files/geoip.metadb ]; then \
      echo '[build] using pre-synced core assets (skip prepare.mjs)'; \
    else \
      echo '[build] core assets missing, downloading via prepare.mjs'; \
      node scripts/prepare.mjs; \
    fi \
    && chmod 755 extra/sidecar/mihomo extra/sidecar/mihomo-alpha extra/sidecar/mihomo-smart \
    && pnpm exec electron-vite build \
    && node -e "const e=require('./package.json');console.log('built', e.version)"

# ------------------------------------------------------------------ runtime --
FROM node:22-slim

# Electron/Chromium runtime libs. The *-t64 rename (bookworm -> trixie) is
# handled with wildcards so this works on either Debian suite.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       xvfb xauth \
       libnss3 libnspr4 libxss1 libxtst6 libxrandr2 libxkbcommon0 \
       libdrm2 libgbm1 libpango-1.0-0 libcairo2 \
       'libgtk-3-0*' 'libasound2*' 'libatk1.0-0*' 'libatk-bridge2.0-0*' 'libcups2*' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /src/out ./out
COPY --from=builder /src/extra ./extra
# pnpm links the file: dep node_modules/sysproxy-rs -> ../../src/native/sysproxy,
# so the symlink target must exist in the image too.
COPY --from=builder /src/src/native/sysproxy ./src/native/sysproxy
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/package.json ./
COPY deploy/party/entrypoint.sh /usr/local/bin/cpx-party-entrypoint
RUN chmod +x /usr/local/bin/cpx-party-entrypoint

# HOME=/data makes the unpackaged app's userData land in the named volume:
# /data/.config/mihomo-party-dev (config.yaml / mihomo.yaml / profiles / logs).
ENV HOME=/data \
    CP_WEB_MODE=1 \
    CP_WEB_HOST=0.0.0.0 \
    CP_WEB_PORT=3999 \
    NODE_ENV=production

VOLUME /data
EXPOSE 3999 7890

# --no-sandbox: required when Chromium runs as root inside a container.
ENTRYPOINT ["cpx-party-entrypoint"]
