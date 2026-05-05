# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the scaffolded Next.js app. Relies on Next's
# `output: "standalone"` (set in `next.config.ts`) to produce a
# self-contained server bundle that runs without devDependencies at
# runtime. Mirrors the structure of the upstream NexPress monorepo
# image but flattened for a single-package scaffold.

FROM node:22-alpine AS base
# `sharp` (image processor used by @nexpress/core) needs libvips at
# runtime — install once in the base layer so both build and runner
# stages have it.
RUN apk add --no-cache vips libc6-compat
RUN corepack enable pnpm

# ─── Builder ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
ENV CI=true \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# `public/` is optional in fresh scaffolds; ensure it exists so the
# runner-stage COPY always has a source path to read (Docker's COPY
# does not treat unmatched glob sources as zero-match).
RUN mkdir -p public
# `--config.confirmModulesPurge=false` keeps pnpm from prompting the
# (non-existent) TTY when the lockfile shape changes between rebuilds.
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false
# Inline placeholders for the build only — Next page-data collection
# imports every route, which transitively triggers nexpress.config.ts's
# zod validation (NP_SECRET non-empty, DATABASE_URL set). These env
# vars do NOT propagate into the runner stage; supply real values at
# `docker run` time.
RUN NP_SECRET=placeholder-build-time-secret-replaced-at-runtime \
    DATABASE_URL=postgres://placeholder:placeholder@placeholder:5432/placeholder \
    pnpm build

# ─── Runner ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user. The standalone server needs read access to
# /app and write access to /app/public/media when using the default
# LocalStorageAdapter (override the storage path via NP_STORAGE_DIR
# or switch to S3 with NP_STORAGE_ADAPTER=s3).
RUN addgroup -S nexpress && adduser -S nexpress -G nexpress \
    && mkdir -p /app/public/media \
    && chown -R nexpress:nexpress /app

COPY --from=builder --chown=nexpress:nexpress /app/.next/standalone ./
COPY --from=builder --chown=nexpress:nexpress /app/.next/static ./.next/static
COPY --from=builder --chown=nexpress:nexpress /app/public ./public

USER nexpress
EXPOSE 3000

# Cheap liveness probe — /api/health returns 200 with no DB
# dependency, so it works even if Postgres is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/api/health || exit 1

# Standalone output places the server entrypoint at the project root.
CMD ["node", "server.js"]
