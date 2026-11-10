# syntax=docker/dockerfile:1

# One image: the Next.js server (web UI, JSON API, MCP server) and the import worker, run side by
# side by scripts/start-container.sh. Deploy the last stage (no --target).
#
# The host passes PORT (80 by default) and the database connection: DATABASE_URL, plus
# DATABASE_PGSSLCA_BASE64 for TLS. Every table lives in the
# `grantledger` schema (src/lib/db/schema-name.ts).
#
# Run locally:  docker build -t grantledger . && docker run --env-file .env -p 3000:80 grantledger

# ---------------------------------------------------------------------------
# Build: for the target platform, since the standalone output carries native modules (sharp).
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .
# next build -> .next/standalone + .next/static; the worker and CLI scripts -> dist/
RUN npm run build

# ---------------------------------------------------------------------------
# App: the standalone server, the bundled worker and CLI scripts, and the SQL migrations.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=80 \
    MIGRATIONS_DIR=/app/drizzle \
    DATA_DIR=/app/data \
    TZ=America/Edmonton
WORKDIR /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node --chmod=755 scripts/start-container.sh ./start-container.sh
# Downloads land here; they are re-fetched after a restart if needed
RUN mkdir -p /app/data && chown node:node /app/data

# Port 80 as an unprivileged user: Docker 20.10 and later lets containers on bridge networking
# bind ports below 1024 without root.
USER node
EXPOSE 80

# Startup validates settings, runs migrations and creates the admin user; /api/health (also a
# good load balancer health check) answers 503 until it has.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 80) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["./start-container.sh"]
