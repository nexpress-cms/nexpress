# apps/web — AGENTS.md

**Current events and operations slice:** AP-503 and related AP-508 reuse the
canonical event envelope, existing trigger/Run tables, Runtime admission,
executor and generic worker registry. Exact immutable triggers, bounded filters,
per-recipe durable event/schedule progress and current authority checks preserve
healthy admissions across sibling failures. Run rows are the schedule outbox;
no synthetic schedule event is introduced. Explicit host registration owns six
closed jobs and private fair cursors under `agents.runtime.jobs`; absent Runtime
stays disabled. Initial Run job quota reservations use existing audit receipts,
and recovery does not charge them again. Only expired, dispatched, unreferenced
events are pruned. Agent job errors and diagnostics remain safe aggregates.
Local verification passed workspace 113/lint 41, Core unit 1,894, Core
PostgreSQL 68, web PostgreSQL 1,401 ordinary cases across full/corrected runs
(including theme 5), native preview 1, Redis 16, production browser 62 and
packed 40-package/56-stage checks. Doctor remains 40 tables/266 critical
constraints. No migration, provider call,
automatic factory, seed, default activation, package version or changeset is
added. AP-507, remaining AP-508 and full R5 acceptance stay open. Current
verification is recorded in [the events and operations flow](../../docs/design/agentic-platform/r5-runtime-events-operations-flow.md).

**Earlier delegated execution slice:** Explicit self-delegation on the existing
Agent create command binds a real staff user; omitted authority remains
deployment-only. Runtime admission freezes principal/staff/deployment authority
and rechecks live scope, membership and item access. Existing ChangeSet,
approval, invocation and execution services own Runtime mutations and explicit
approval resumption; the request action stays immutable and only its exact
approved-execution receipt fulfills it. Membership changes invalidate old
Run authority, including removal/regrant. No users, sessions or delegation are
synthesized from an Agent creator. Local acceptance passed verify 113/lint 41,
Core unit 1,854, Core PostgreSQL 67, web PostgreSQL 1,373 (theme 5), native
preview 1, Redis 16, production browser 62 and packed 40-package/56-stage
checks. The full R5 gate remains open for AP-503/AP-507/AP-508. Doctor remains
40 tables/266 critical constraints, with no migration, automatic worker, seed,
default activation,
package versions or changesets. See [the delegated execution flow](../../docs/design/agentic-platform/r5-runtime-delegated-execution-flow.md).

AP-500/AP-502/AP-504 add only a thin `scripts/agent-runtime.ts` wrapper and
`agent:runtime` script for the shared local status/pause/reviewed-resume facade.
The explicit deployment actor fingerprint is environment-only; wrappers do not
construct workers, provider adapters, schedulers or automatic runtime services.
Absent readiness blocks resume while local status/pause remain available.
Generated migrations 0046/0047 extend the run table and nine runtime tables;
Doctor is 40 Agent tables/265 critical constraints/15 deferred lifecycle foreign
keys, ordinary deletion 39 tables. Reuse the existing runtime service fixture
for controls and negative PostgreSQL cases. Runtime configuration HTTP routes
and Studio views remain AP-507; no versions/changesets or default activation
are added. See the R5 runtime foundation flow for current scope and validation.

Earlier R4 slice:

AP-406 uses the existing four Agent HTTP wrappers and shared MCP entrypoints; do not add parallel execution routes or automatic Gateway/runtime installation. Current Activity uses the explicitly injected ChangeSet read facade and safe execution projections. Migration 0045 updates the existing stdio MCP-mode constraint; Doctor remains 31 Agent tables/167 critical constraints/11 deferred lifecycle foreign keys. All 1,181 ordinary PostgreSQL cases passed across the full run and corrected regressions; native preview passed separately. Live Redis 16, restored theme-render 5, production browser 62 and packed 40-package/56-stage checks passed. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow.

Rollback preparation/request-approval/execute routes remain thin shared-app exports; cancellation reuses the existing ChangeSet route. Runtime, keys/definitions, intent and verification are explicitly injected; wrappers do not enable workers or Gateway execution. The preceding rollback slice passed its recorded validation; see the R4 rollback flow results.

Next.js 16 reference app. This app is intentionally thin: most route
handlers, pages, scripts, proxy behavior, and setup flows are re-exported
from `@nexpress/app`, while `apps/web` supplies the local config,
collections, generated schema, and package wiring used for monorepo
development.

## Structure

```text
src/
├── app/
│   ├── (site)/             # Public route wrappers
│   ├── (member)/           # Member-auth route wrappers
│   ├── (admin)/admin/      # Admin login + protected shell wrappers
│   ├── api/                # API route wrappers around @nexpress/app
│   ├── sitemap.xml/        # Root SEO route wrapper
│   ├── feed.xml/           # Root feed route wrapper
│   └── robots.txt/         # Root robots route wrapper
├── lib/
│   ├── bootstrap.ts        # createBootstrap({ config, generatedSchema })
│   ├── init-core.ts        # Re-exports @nexpress/app/lib/init-core
│   ├── auth-helpers.ts     # Staff auth helper re-export
│   ├── member-auth-helpers.ts # Member auth helper re-export
│   ├── collection-helpers.ts  # Collection helper re-export
│   └── revalidate.ts       # revalidateCollection wrapper
├── collections/            # defineCollection configs
├── db/generated/           # AUTO-GENERATED Drizzle tables/types
├── proxy.ts                # Next 16 proxy re-export from @nexpress/app/proxy
├── nexpress.config.ts      # Site config
└── globals.css
```

## Where To Look

| Task                                                         | File(s)                                                                                                             | Notes                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Change bootstrap / service wiring                            | `src/lib/bootstrap.ts`, `packages/next/src/bootstrap.ts`, `packages/app/src/lib/init-core.ts`                       | App routes should call `ensureFor(...)`, not the low-level bootstrap exports directly.   |
| Add/change a collection                                      | `src/collections/*.ts`                                                                                              | Then run `pnpm db:generate` and review/apply the migration.                              |
| Change shared app route behavior                             | `packages/app/src/**`                                                                                               | `apps/web/src/app/**` is mostly wrappers; edit the shared implementation first.          |
| Add a project-only route wrapper                             | `src/app/**/route.ts` or `src/app/**/page.tsx`                                                                      | Prefer a two-line re-export from `@nexpress/app` when the behavior is shared.            |
| Change rate limits, CSRF exemptions, CSP, or request headers | `src/proxy.ts`, `packages/app/src/proxy/index.ts`                                                                   | `src/proxy.ts` re-exports the shared Next 16 proxy.                                      |
| Change staff auth cookies/helpers                            | `src/lib/auth-helpers.ts`, `packages/app/src/lib/auth-helpers.ts`, `packages/next/src/auth.ts`                      | CSRF enforcement is centralized in proxy for API mutations.                              |
| Change member auth helpers                                   | `src/lib/member-auth-helpers.ts`, `packages/app/src/lib/member-auth-helpers.ts`, `packages/next/src/member-auth.ts` | Member cookies use the `np-mb-*` namespace.                                              |
| Change site rendering                                        | `packages/app/src/site/**`, theme packages                                                                          | Public catch-all dispatches page slug, slug redirects, theme routes, then plugin routes. |
| Change sitemap/feed/robots or metadata contracts             | `packages/core/src/seo/**`, `packages/app/src/root/**`, `packages/theme/src/define-theme.ts`                        | `@nexpress/core/seo` validates every contribution before rendering/cache.                |
| Change admin surfaces                                        | `packages/app/src/admin/**`, `packages/admin/src/**`                                                                | Client components come from `@nexpress/admin/client`.                                    |

## Bootstrap Convention

Use the intent-based entry point from `@/lib/init-core`:

```ts
import { ensureFor } from "@/lib/init-core";

await ensureFor("read"); // DB + storage + collections
await ensureFor("plugins"); // read + plugin loading
await ensureFor("worker"); // plugins + email, dedicated worker only
await ensureFor("write"); // plugins + email + job producer
```

`src/lib/bootstrap.ts` exposes the same `ensureFor` contract plus `getDb`,
`reloadPlugins`, and terminal `shutdownBootstrap`. Route/page code should use
the wrapper from `src/lib/init-core.ts`; standalone scripts must shut the
bootstrap down before exiting.

## Auth And CSRF

- Staff login flows use `np-session`, `np-refresh`, and `np-csrf`.
- Member login flows use the member auth helpers and `np-mb-*` cookies.
- State-changing `/api/*` requests are CSRF-checked in
  `packages/app/src/proxy/index.ts`; do not add ad-hoc per-handler
  `requireCsrf()` calls unless a route deliberately bypasses the shared proxy.
- Server parents resolve capability flags with `can(user, capability)` and
  pass booleans to client shells. Do not import `@nexpress/core` into client
  components.

## Anti-Patterns

- Do not edit `src/db/generated/collections.ts` by hand.
- Do not create another DB pool; use `getDb()` from bootstrap after
  `ensureFor(...)`.
- Do not import `@nexpress/admin` from public `(site)` routes.
- Do not import `next/cache` directly from app code; use
  `revalidateCollection()` or the shared cache helpers.
- Do not copy a large `@nexpress/app` implementation into `apps/web` unless
  the reference app truly needs to diverge.
