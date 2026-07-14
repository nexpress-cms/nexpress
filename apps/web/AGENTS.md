# apps/web — AGENTS.md

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
