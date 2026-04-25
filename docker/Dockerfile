# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the @nexpress/web Next.js app. Relies on Next's
# `output: "standalone"` mode to produce a self-contained server bundle
# that runs without the rest of the workspace at runtime.

FROM node:22-alpine AS base
# `sharp` (image processor) needs libvips at runtime — install once in the
# base layer so both build and runner pick it up.
RUN apk add --no-cache vips libc6-compat
RUN corepack enable pnpm

# ─── Builder ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
# Build-time env: Next page-data collection imports every route module
# which transitively evaluates `nexpress.config.ts` and triggers
# `defineConfig`'s zod validation — including a non-empty `NX_SECRET`.
# A placeholder satisfies the validator without leaking into the runtime
# image (the runner stage doesn't inherit these).
ENV CI=true \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# `apps/web/public/` is optional — fresh scaffolds may not have it.
# Ensure it exists in the builder stage so the runner-stage COPY
# always has a source path to read (Docker's COPY does NOT treat
# unmatched glob sources as zero-match). (#68)
RUN mkdir -p apps/web/public
# `--config.confirmModulesPurge=false` keeps pnpm from prompting the
# (non-existent) TTY when the workspace shape changes between rebuilds.
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false
# Inline placeholders for the build only — Next page-data collection
# imports every route, which transitively triggers nexpress.config.ts's
# zod validation. These env vars don't propagate into the runner stage.
RUN NX_SECRET=placeholder-build-time-secret-replaced-at-runtime \
    DATABASE_URL=postgres://placeholder:placeholder@placeholder:5432/placeholder \
    pnpm build

# ─── Runner ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user. Next's standalone server only needs read access
# to /app and write access to /app/uploads (when using LocalStorageAdapter).
RUN addgroup -S nexpress && adduser -S nexpress -G nexpress \
    && mkdir -p /app/uploads \
    && chown -R nexpress:nexpress /app

COPY --from=builder --chown=nexpress:nexpress /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nexpress:nexpress /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nexpress:nexpress /app/apps/web/public ./apps/web/public

USER nexpress
EXPOSE 3000

# Cheap liveness probe — the /api/health endpoint returns 200 with no DB
# dependency, so it works even if Postgres is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/api/health || exit 1

# Standalone output places the server entrypoint at apps/web/server.js.
CMD ["node", "apps/web/server.js"]
