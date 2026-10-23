# syntax=docker/dockerfile:1
#
# Atomic sync server. Build from the repository root (the server imports the
# @atomic/core workspace package):
#
#   docker build -f apps/server/Dockerfile -t atomic-server .
#   docker run -p 3000:3000 -e BETTER_AUTH_SECRET=... -v atomic-data:/data atomic-server
#
# Production: deploy/docker-compose.yml (TLS, local model, backups) and
# deploy/README.md (the runbook).

ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
# Only the server and the workspace package it imports; bun skips the other
# workspaces listed in bun.lock. `--omit peer` keeps optional peers that the
# shared lockfile resolves through other apps (Expo, React Native, Prisma,
# React…) out of the image: ~110 MB of node_modules instead of ~650 MB. The
# server never loads React: `@atomic/core` keeps it behind `@atomic/core/react`
# (core's `core-imports.test.ts` guards that).
COPY package.json bun.lock bunfig.toml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production --ignore-scripts --omit peer --filter server

FROM oven/bun:${BUN_VERSION}-slim
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_URL=file:/data/atomic.db \
	BLOB_DIR=/data/blobs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Sources only: never a developer's local.db, blobs/, .env or tests.
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
WORKDIR /app/apps/server
EXPOSE 3000
# `/healthz` answers 200 while the database does (a down AI model never
# restarts the server). The image has no curl: bun does the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "run", "src/index.ts"]
