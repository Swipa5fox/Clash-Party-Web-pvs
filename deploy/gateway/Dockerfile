FROM node:22-slim

WORKDIR /app

# Zero runtime dependencies — the gateway uses only Node built-ins (including node:sqlite).
# No `npm install` needed. Copy sources and expose the admin CLI on PATH.
COPY package.json ./
COPY src ./src
COPY admin.mjs ./

RUN chmod +x /app/admin.mjs \
    && ln -sf /app/admin.mjs /usr/local/bin/cpx-admin \
    && mkdir -p /data

ENV NODE_ENV=production
EXPOSE 8080

# Run node as PID 1 so it receives stop signals directly.
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
