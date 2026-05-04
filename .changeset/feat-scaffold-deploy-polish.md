---
"create-nexpress": patch
---

Production-grade polish for scaffolded deploys.

**Dockerfile** — multi-stage build with non-root `nexpress` user,
sharp / vips runtime deps, build-time placeholder env vars so
`nexpress.config.ts`'s zod validation passes during `next build`,
and a `HEALTHCHECK` against `/api/health`. The previous 22-line
template was a hello-world skeleton; this matches the upstream
NexPress monorepo image, adapted for the single-package scaffold
layout.

**`.dockerignore`** — emitted at the project root (build context
root) when Docker setup is opted into. Without it the build
context pulls in `node_modules`, `.next`, and `.git`.

**`vercel.json`** — always emitted with a cron entry for
`/api/internal/publish-scheduled` per `docs/deployment.md` Path 2.
Harmless on non-Vercel hosts; the route short-circuits when
`NX_SCHEDULER_TOKEN` is unset.

**`pnpm doctor:prod`** — new `--prod` mode on the existing doctor
script. Tightens the dev defaults: `NX_SECRET < 32 chars` becomes
an error, missing `NX_ENABLE_JOBS` warns (jobs would silently
drop), `NX_STORAGE_ADAPTER=local` on a multi-node platform
errors (mirrors `verifyStartupSafety`'s heuristic), `http://`
SITE_URL warns. Wire into release CI to fail before bad config
ships.

**`scripts/_load-env.ts`** — fix: doctor.ts has been importing
`./_load-env.js` since #404 but the template was never added to
the cli scaffold. Without it `pnpm doctor` crashed at module
load with `ERR_MODULE_NOT_FOUND`.
