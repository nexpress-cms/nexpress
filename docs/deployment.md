# Deployment

NexPress is a standard Next.js 15 app with a Postgres dependency. Any host
that runs Node.js 20+ with a managed Postgres works. This guide covers
three concrete paths plus the env-var surface you need on all of them.

---

## Required environment

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres DSN | At least one DB role with DDL — drizzle-kit migrations create tables on first deploy. |
| `NX_SECRET` | JWT signing key | **≥ 32 random chars in production.** Rotating logs every user out. |
| `SITE_URL` | Canonical site origin | Used in `og:url`, password-reset links, OpenAPI `servers`. |

Optional (defaults shown in `.env.example`):

- `NX_STORAGE_ADAPTER` — `local` (default) or `s3`. S3 also needs `NX_S3_BUCKET`, `NX_S3_REGION`, optional `NX_S3_ENDPOINT` (MinIO / R2).
- `NX_ENABLE_JOBS=1` — start the pg-boss worker. Without it, write-side
  follow-up jobs (revalidation, email send) silently drop. **Required in
  production.**
- `NX_SCHEDULER_TOKEN` — Bearer token guarding `/api/internal/*`. Leave
  unset to disable those endpoints. See [scheduled-publishing.md](./scheduled-publishing.md).
- `NX_EMAIL_ADAPTER=smtp` + `NX_SMTP_*` — real password-reset / invite
  delivery. Default no-op adapter logs the reset URL to stdout.

---

## Path 1: Docker self-host

The repo ships a multi-stage Dockerfile that produces a ~275 MB image
running as a non-root user. Verified end-to-end (image builds, container
starts, `/api/health` returns 200):

```bash
# from the repo root
docker build -f docker/Dockerfile -t nexpress .

docker run -d \
  --name nexpress \
  -p 3000:3000 \
  -v nexpress-uploads:/app/uploads \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e NX_SECRET="$(openssl rand -hex 32)" \
  -e SITE_URL=https://yourdomain.com \
  -e NX_ENABLE_JOBS=1 \
  nexpress
```

Run drizzle migrations once before the first start (or on every deploy in
your CI):

```bash
docker run --rm \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  nexpress \
  pnpm --filter @nexpress/web db:migrate
```

> **Storage caveat:** the `LocalStorageAdapter` writes to `/app/uploads`.
> A volume mount keeps uploads across redeploys, but the local adapter is
> **single-node only** — for multi-node deploys switch to `NX_STORAGE_ADAPTER=s3`.

A reference Compose file for db + minio lives at `docker/docker-compose.yml`.
For production, point `DATABASE_URL` at a managed Postgres (RDS, Supabase,
Neon, Fly.io Postgres, etc.) instead.

### Image build notes

- Build context relies on `.dockerignore` to stay under ~50 MB. Don't
  delete that file — without it the build pulls in `node_modules`,
  `.next`, `uploads`, and `.git` (~7 GB).
- `nexpress.config.ts` validates at module-load time, so the build needs
  `NX_SECRET` and `DATABASE_URL` set during `next build` for page-data
  collection. The Dockerfile injects placeholder values for the build
  stage; the runner stage requires the real values at `docker run` time.
- `sharp` (image processor) needs `vips` + `libc6-compat` on Alpine.
  The base layer installs both.

---

## Path 2: Vercel

Works out of the box thanks to `output: "standalone"` + Next 15 Vercel
support. One-time setup:

1. Push the repo to GitHub / GitLab and import it in the Vercel
   dashboard. Pick the root of the monorepo — Vercel auto-detects the
   `apps/web` workspace via the Next plugin.
2. Add the env vars from "Required environment" above. For the DB,
   pick one of:
   - **Vercel Postgres** — set `DATABASE_URL` to the connection string
     Vercel provides (use the **non-pooled** URL for migrations and the
     pooled URL at runtime).
   - **Neon / Supabase** — paste their connection string directly.
3. Add a build command override if needed: `pnpm build --filter=@nexpress/web`.
4. Configure a Vercel Cron entry to drive scheduled publishing:

   ```json
   // vercel.json
   {
     "crons": [{ "path": "/api/internal/publish-scheduled", "schedule": "*/2 * * * *" }]
   }
   ```

   Vercel sets `Authorization: Bearer <CRON_SECRET>` automatically — make
   `NX_SCHEDULER_TOKEN` equal to whatever you set as the Vercel cron
   secret.

5. Add a deploy hook that runs `pnpm db:migrate` once per deploy. Either
   wire it into the Vercel build command (`pnpm db:migrate && pnpm build`)
   or run it from your CI before promoting.

> **Storage:** Vercel filesystem is ephemeral — you must use S3 or an
> equivalent. Set `NX_STORAGE_ADAPTER=s3` and the matching `NX_S3_*` vars.

---

## Path 3: Fly.io

`fly launch` against the included Dockerfile then add the environment:

```bash
fly secrets set \
  DATABASE_URL=postgres://...:5432/nexpress \
  NX_SECRET="$(openssl rand -hex 32)" \
  SITE_URL=https://your-app.fly.dev \
  NX_ENABLE_JOBS=1 \
  NX_SCHEDULER_TOKEN="$(openssl rand -hex 32)"
```

Fly's Postgres add-on works via `fly postgres create` and `fly postgres
attach`. Storage: use Fly's mounted volumes for single-node deploys, or
switch to S3 for HA setups.

For scheduled publishing, drive `/api/internal/publish-scheduled` from a
separate machine with `supercronic`, or use Fly's [scheduled machines](https://fly.io/docs/launch/cron/).

---

## First-deploy checklist

1. Run drizzle migrations: `pnpm --filter @nexpress/web db:migrate`.
2. Seed the initial admin user with `pnpm --filter @nexpress/web seed:admin`
   (set `NX_ADMIN_EMAIL`, `NX_ADMIN_NAME`, `NX_ADMIN_PASSWORD` first), or
   register via `/admin/login` if your config allows it.
3. Confirm `/api/health` returns `{"status":"ok"}` and `/api/health/ready`
   returns 200 with every probe `ok: true`. The readiness probe pings
   the DB and (when wired) the pg-boss queue (Phase 22.4) — a 503 here
   means traffic should not be routed to this node yet.
4. Confirm `/api/openapi.json` lists every collection — agents and the
   admin both rely on it being accurate (no cache, rebuilt per request).
5. Wire scheduled publishing if your collections use `_status: "scheduled"`.
6. (If using SMTP) trigger a password reset and confirm an email arrives.
7. Tail the boot logs for warnings emitted by `verifyStartupSafety`
   (Phase 22.2). Each warning carries a `check` id (see
   [operations.md § Boot warnings](./operations.md#boot-warnings)) and
   names a fix. A clean boot has none.

---

## Structured logging

The default `consoleLogger` is fine for development and small self-hosted
deployments. Production deployments that already run a log pipeline
(pino, Datadog, Axiom, …) should swap in a custom logger so framework
warnings — including the Phase 22.2 boot checks and the pg-boss handler
errors — land in the same stream as application logs.

Install once at app boot, before the first `ensureFor(...)` call. The
canonical install location in the reference app is
`apps/web/src/lib/init-core.ts`, next to the email-adapter setup:

```ts
import { setLogger } from "@nexpress/core";
import pino from "pino";

const root = pino({ level: process.env.LOG_LEVEL ?? "info" });
setLogger({
  debug: (msg, ctx) => root.debug(ctx ?? {}, msg),
  info: (msg, ctx) => root.info(ctx ?? {}, msg),
  warn: (msg, ctx) => root.warn(ctx ?? {}, msg),
  error: (msg, ctx) => root.error(ctx ?? {}, msg),
  // Optional but recommended — `getScopedLogger({...})` calls forward
  // bindings here so plugin / boot / job logs carry their subsystem
  // tag through your pipeline.
  child: (bindings) => {
    const c = root.child(bindings);
    return {
      debug: (msg, ctx) => c.debug(ctx ?? {}, msg),
      info: (msg, ctx) => c.info(ctx ?? {}, msg),
      warn: (msg, ctx) => c.warn(ctx ?? {}, msg),
      error: (msg, ctx) => c.error(ctx ?? {}, msg),
    };
  },
});
```

For a Sentry / pino / Datadog-specific recipe and the matching
`setErrorReporter` setup, see
[observability.md](./observability.md).

---

## Multi-node notes

- **Cookies are stateless.** Sessions are JWT-based, so any node can
  validate any session without sticky routing.
- **Plugin in-process state isn't shared.** Hooks and registered
  actions live in the loaded plugin process. Restart all nodes after
  changing `nexpress.config.ts` plugin entries.
- **`LocalStorageAdapter` is not multi-node safe.** Different nodes will
  see different `./uploads` directories. Use S3 (or any object store) in
  HA topologies.
- **pg-boss leader election** — the worker uses Postgres advisory locks,
  so multiple nodes can run `NX_ENABLE_JOBS=1` simultaneously. Only one
  picks up each job.
- **Rate limiting is per-process.** `apps/web/src/proxy.ts` keeps its
  IP/path bucket counters in an in-memory `Map`. With N instances behind
  a load balancer the effective limit is `N × configured`, so a 10/min
  cap on `/api/auth/login` lets through 40 requests on a 4-node cluster.
  This is by design, not a bug — but you need to layer a real rate
  limiter upstream:
  - **Cloudflare / Vercel** — configure rate limit rules at the edge
    (IP + path pattern). The in-process `Map` becomes a defence-in-depth
    fallback.
  - **NGINX** — `limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;`
    plus `limit_req zone=api burst=20 nodelay;` on `location /api/auth`.
  - **Caddy** — the [`rate_limit`](https://caddyserver.com/docs/modules/http.handlers.rate_limit)
    handler, scoped per route.
  - **Single-node deployments** — the in-process map is sufficient.
  See issue #269 for the design discussion (Postgres-backed rate
  limiting is intentionally not recommended).
