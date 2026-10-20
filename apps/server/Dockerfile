# syntax=docker/dockerfile:1
#
# Atomic sync server. Build from the repository root (the server imports the
# @atomic/core workspace package):
#
#   docker build -f apps/server/Dockerfile -t atomic-server .
#   docker run -p 3000:3000 -e BETTER_AUTH_SECRET=... -v atomic-data:/data atomic-server

ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
# Only the server and the workspace package it imports; bun skips the other
# workspaces listed in bun.lock. `--omit peer` keeps optional peers that the
# shared lockfile resolves through other apps (Expo, React Native, Prisma, …)
# out of the image: ~90 MB of node_modules instead of ~650 MB.
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
COPY packages/core ./packages/core
COPY apps/server ./apps/server
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "run", "src/index.ts"]
