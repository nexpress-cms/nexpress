# Deployment

NexPress is a standard Next.js 15 app with a Postgres dependency. Any host
that runs Node.js 20+ with a managed Postgres works. This guide covers
three concrete paths plus the env-var surface you need on all of them.

---

## Required environment

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres DSN | At least one DB role with DDL — drizzle-kit migrations create tables on first deploy. |
| `NP_SECRET` | JWT signing key | **≥ 32 random chars in production.** Rotating logs every user out. |
| `SITE_URL` | Canonical site origin | Used in `og:url`, password-reset links, OpenAPI `servers`. |

Optional (defaults shown in `.env.example`):

- `NP_STORAGE_ADAPTER` — `local` (default) or `s3`. S3 also needs `NP_S3_BUCKET`, `NP_S3_REGION`, optional `NP_S3_ENDPOINT` (MinIO / R2).
- `NP_ENABLE_JOBS=1` — start the pg-boss worker. Without it, write-side
  follow-up jobs (revalidation, email send) silently drop. **Required in
  production.**
- `NP_SCHEDULER_TOKEN` — Bearer token guarding `/api/internal/*`. Leave
  unset to disable those endpoints. See [scheduled-publishing.md](./scheduled-publishing.md).
- `NP_EMAIL_ADAPTER=smtp` + `NP_SMTP_*` — real password-reset / invite
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
  -e NP_SECRET="$(openssl rand -hex 32)" \
  -e SITE_URL=https://yourdomain.com \
  -e NP_ENABLE_JOBS=1 \
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
> **single-node only** — for multi-node deploys switch to `NP_STORAGE_ADAPTER=s3`.

A reference Compose file for db + minio lives at `docker/docker-compose.yml`.
For production, point `DATABASE_URL` at a managed Postgres (RDS, Supabase,
Neon, Fly.io Postgres, etc.) instead.

### Image build notes

- Build context relies on `.dockerignore` to stay under ~50 MB. Don't
  delete that file — without it the build pulls in `node_modules`,
  `.next`, `uploads`, and `.git` (~7 GB).
- `nexpress.config.ts` validates at module-load time, so the build needs
  `NP_SECRET` and `DATABASE_URL` set during `next build` for page-data
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
   `NP_SCHEDULER_TOKEN` equal to whatever you set as the Vercel cron
   secret.

5. Add a deploy hook that runs `pnpm db:migrate` once per deploy. Either
   wire it into the Vercel build command (`pnpm db:migrate && pnpm build`)
   or run it from your CI before promoting.

> **Storage:** Vercel filesystem is ephemeral — you must use S3 or an
> equivalent. Set `NP_STORAGE_ADAPTER=s3` and the matching `NP_S3_*` vars.

---

## Path 3: Fly.io

`fly launch` against the included Dockerfile then add the environment:

```bash
fly secrets set \
  DATABASE_URL=postgres://...:5432/nexpress \
  NP_SECRET="$(openssl rand -hex 32)" \
  SITE_URL=https://your-app.fly.dev \
  NP_ENABLE_JOBS=1 \
  NP_SCHEDULER_TOKEN="$(openssl rand -hex 32)"
```

Fly's Postgres add-on works via `fly postgres create` and `fly postgres
attach`. Storage: use Fly's mounted volumes for single-node deploys, or
switch to S3 for HA setups.

For scheduled publishing, drive `/api/internal/publish-scheduled` from a
separate machine with `supercronic`, or use Fly's [scheduled machines](https://fly.io/docs/launch/cron/).

---

## Path 4: Render

Render builds the included Dockerfile and runs it. Two services:

1. **Web service** — type "Web Service", "Existing Dockerfile",
   pointed at `docker/Dockerfile`. Set the env vars from "Required
   environment" above plus `NP_ENABLE_JOBS=1` (the worker shares the
   same process by default; if you split it, see "Background worker"
   below). Health check path: `/api/health/ready`. Render restarts
   instances that return non-200, which catches a DB outage at boot.
2. **Postgres** — Render Postgres, Standard plan or above for
   production. Copy the **Internal Database URL** into `DATABASE_URL`
   on the web service so traffic stays on Render's private network.
   The external URL works too but pays egress.

```bash
# Run migrations once, before the first deploy completes:
render shell --service nexpress-web -- pnpm --filter @nexpress/web db:migrate
# Or: set the build command to `pnpm db:migrate && pnpm build` so
# every deploy migrates idempotently.
```

Scheduled publishing — Render has [Cron Jobs](https://docs.render.com/cronjobs)
as a separate service type. Add one calling
`curl -fsS -H "Authorization: Bearer $NP_SCHEDULER_TOKEN" https://your-app.onrender.com/api/internal/publish-scheduled`
on a `*/2 * * * *` schedule. Set the same `NP_SCHEDULER_TOKEN` value
on the web service.

> **Storage:** Render disks are per-instance and not shared across
> replicas. For >1 instance set `NP_STORAGE_ADAPTER=s3` (Render emits
> `RENDER_INSTANCE_ID` so the boot-time `multi_node_local_storage`
> warning fires automatically; see [operations.md](./operations.md#boot-warnings)).

### Background worker (optional)

Heavy job throughput justifies a dedicated **Background Worker** service
on Render — same image, command override `node apps/web/server.js`
swapped for the worker entry, `NP_ENABLE_JOBS=1` only on this service
(unset on the web service so two processes don't both poll). pg-boss
uses Postgres advisory locks for leader election, so even with
`NP_ENABLE_JOBS=1` everywhere, only one instance picks up each job.

---

## Path 5: Railway

Railway also builds the included Dockerfile. The shape mirrors Render:

1. **New Project → Deploy from GitHub repo**, select the NexPress repo.
   Railway autodetects `docker/Dockerfile` (or set `Dockerfile Path`
   in Settings → Build).
2. **Add Postgres**: New → Database → PostgreSQL. Railway exposes
   `DATABASE_URL` automatically as a [reference variable](https://docs.railway.com/guides/variables#reference-variables) —
   set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the web service so
   it picks up the credentials without copy-paste.
3. **Env vars** on the web service: `NP_SECRET`, `SITE_URL` (use the
   railway.app domain or your custom one), `NP_ENABLE_JOBS=1`,
   `NP_SCHEDULER_TOKEN`. Generate the secrets with
   `openssl rand -base64 48` / `openssl rand -hex 32`.
4. **Health check**: Settings → Networking → Healthcheck Path
   `/api/health/ready`, timeout 10s.

Migrations: Railway has no first-class one-shot job runner. Two
options:

- **Build-time** — set the Build Command to
  `pnpm install && pnpm --filter @nexpress/web db:migrate && pnpm build`.
  Migrations run on every deploy; idempotent.
- **One-off** — `railway run --service web pnpm --filter @nexpress/web db:migrate`
  from a local checkout pointed at the Railway env.

Scheduled publishing — Railway's [Cron Jobs](https://docs.railway.com/reference/cron-jobs)
let a service run on a cron schedule. Add a separate service that just
runs `curl -fsS -H "Authorization: Bearer $NP_SCHEDULER_TOKEN" $SITE_URL/api/internal/publish-scheduled`,
schedule `*/2 * * * *`, share `NP_SCHEDULER_TOKEN` and `SITE_URL` via
[shared variables](https://docs.railway.com/guides/variables#shared-variables).

> **Storage:** Railway's filesystem is ephemeral across deploys.
> `NP_STORAGE_ADAPTER=s3` is required for any media uploads to survive
> a redeploy. Railway emits `RAILWAY_ENVIRONMENT_NAME` so the boot-time
> `multi_node_local_storage` warning fires automatically when
> `NP_STORAGE_ADAPTER=local` is left in production.

---

## First-deploy checklist

1. Run drizzle migrations: `pnpm --filter @nexpress/web db:migrate`.
2. Seed the initial admin user with `pnpm --filter @nexpress/web seed:admin`
   (set `NP_ADMIN_EMAIL`, `NP_ADMIN_NAME`, `NP_ADMIN_PASSWORD` first), or
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
  HA topologies. Boot emits a `multi_node_local_storage` warning when
  either `NP_MULTI_NODE=true` is set or `NODE_ENV=production` *and* a
  managed-container env var is detected (`KUBERNETES_SERVICE_HOST`,
  `FLY_REGION`, `RENDER_INSTANCE_ID`, `RAILWAY_ENVIRONMENT_NAME`).
  Set `NP_STORAGE_ADAPTER=s3` to
  silence the warning, or `NP_MULTI_NODE=false` if you really are
  running single-node on a managed platform.
- **pg-boss leader election** — the worker uses Postgres advisory locks,
  so multiple nodes can run `NP_ENABLE_JOBS=1` simultaneously. Only one
  picks up each job.
- **Rate limiting is pluggable.** As of Phase 23.7, `apps/web/src/proxy.ts`
  reads its limiter from the `NpRateLimiterAdapter` registered via
  `setRateLimiter` at boot. The default adapter is `InMemoryRateLimiter`
  from `@nexpress/core/rate-limit` — same fixed-window behavior as
  before, identical for single-node deploys. Multi-node deploys swap
  the adapter at boot:

  ```ts
  // apps/web/src/lib/init-core.ts (or your app's bootstrap)
  import { setRateLimiter } from "@nexpress/core/rate-limit";
  import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";

  setRateLimiter(new RedisRateLimiter({ url: process.env.NP_REDIS_URL }));
  ```

  With the in-memory default and N instances behind a load balancer
  the effective limit is `N × configured` — a 10/min cap on
  `/api/auth/login` lets through 40 requests on a 4-node cluster.
  Pick one of the multi-node options below before you scale past
  one app process:

  - **`@nexpress/rate-limiter-redis`** — first-party reference adapter.
    A single Lua script issues `INCR` + `PTTL` + conditional
    `PEXPIRE` in one round trip per request, so an unlucky crash
    between the increment and the expiry can't strand a TTL-less
    key. Install + wire:

    ```bash
    pnpm add @nexpress/rate-limiter-redis
    ```

    ```ts
    // apps/web/src/lib/init-core.ts (or your bootstrap)
    import { setRateLimiter } from "@nexpress/core/rate-limit";
    import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";

    setRateLimiter(new RedisRateLimiter({ url: process.env.NP_REDIS_URL }));
    ```

    Recommended when you already have Redis for caching / sessions
    (one client, one connection pool). See the package
    [README](https://github.com/nexpress-cms/nexpress/tree/main/packages/rate-limiter-redis)
    for cluster / sentinel / shared-client patterns.
  - **CDN / edge rate limiter** — Cloudflare / Vercel rules at the
    edge. The in-process default becomes defense-in-depth.
  - **NGINX / Caddy** — `limit_req_zone` (NGINX) or the
    [`rate_limit`](https://caddyserver.com/docs/modules/http.handlers.rate_limit)
    handler (Caddy), scoped per route.
  - **Single-node deployments** — keep the default; no setup
    required.

  Postgres-backed rate limiting is intentionally not provided as a
  first-party adapter — see issue #269 for the design rationale
  (one DB hop per request blows up p99 under burst).
