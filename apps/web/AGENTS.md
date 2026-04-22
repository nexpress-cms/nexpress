# apps/web — AGENTS.md

Next.js 15 reference app. Wires all `@nexpress/*` packages into a working CMS.

**Generated:** 2026-04-22 | **Commit:** 2e07135

## STRUCTURE

```
src/
├── app/
│   ├── (site)/             # Public site routes
│   │   ├── [[...slug]]/    # Catch-all page renderer (renderBlocks)
│   │   ├── blog/           # Blog listing + [slug] detail
│   │   └── layout.tsx      # Calls ensureCoreServices, reads theme/nav
│   ├── (admin)/admin/      # Admin UI
│   │   ├── login/          # Login page (public)
│   │   └── (protected)/    # Server-guarded admin shell (verifyTokenFull)
│   └── api/                # REST endpoints (12 route dirs)
│       ├── auth/           # login, logout, refresh, me, change-password
│       ├── collections/    # [slug]/ and [slug]/[id]/ CRUD
│       ├── media/          # upload, list, [id], folders
│       ├── plugins/        # [pluginId]/[...path] proxy to plugin routes
│       ├── settings/       # theme, general settings
│       ├── navigation/     # nav tree CRUD
│       ├── meta/           # collections + plugins manifests for admin UI
│       ├── import/ export/ # Bulk import/export (257 lines in import)
│       ├── preview/        # Draft preview
│       ├── health/         # Health check
│       └── openapi.json/   # OpenAPI spec
├── lib/
│   ├── bootstrap.ts        # createBootstrap({ config, generatedSchema }) — THE singleton factory
│   ├── init-core.ts        # Re-exports ensureCoreServices/ensurePluginsLoaded
│   ├── auth-helpers.ts     # createAuthHelpers: requireAuth, requireCsrf, cookies
│   ├── collection-helpers.ts # createCollectionHelpers: find/save/delete wrappers
│   ├── manifest.ts         # Builds admin meta JSON from configs
│   ├── db.ts               # getDb re-export
│   └── revalidate.ts       # revalidateCollection (wraps next/cache)
├── collections/            # defineCollection configs (posts.ts, pages.ts)
├── db/generated/           # AUTO-GENERATED — collections.ts (Drizzle tables)
├── middleware.ts            # Security headers + in-memory rate limiter
├── nexpress.config.ts      # Site config (defineConfig)
└── globals.css
```

## WHERE TO LOOK

| Task                            | File(s)                               | Notes                                                                            |
| ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Change bootstrap / service init | `src/lib/bootstrap.ts`                | Calls `createBootstrap` from `@nexpress/next`                                    |
| Add/change a collection         | `src/collections/*.ts`                | Then run `pnpm db:generate && pnpm db:migrate`                                   |
| Add API endpoint                | `src/app/api/<name>/route.ts`         | Call `ensureCoreServices()` first; use `requireAuth`/`requireCsrf` for mutations |
| Change rate limits or CSP       | `src/middleware.ts`                   | In-memory Map; per-regex-path limits                                             |
| Change auth cookie behavior     | `src/lib/auth-helpers.ts`             | Wraps `createAuthHelpers` from `@nexpress/next`                                  |
| Add admin page/route            | `src/app/(admin)/admin/(protected)/`  | Server layout guards auth; client components via `@nexpress/admin/client`        |
| Change site rendering           | `src/app/(site)/[[...slug]]/page.tsx` | Uses `getPageBySlug` + `renderBlocks`                                            |
| Debug auth flow                 | `src/app/api/auth/login/route.ts`     | Credential check → signToken → setAuthCookies                                    |

## AUTH FLOW

1. **Login**: POST `/api/auth/login` → verify password → `signToken` (access + refresh) → `setAuthCookies` (nx-session, nx-refresh, nx-csrf)
2. **Refresh**: POST `/api/auth/refresh` → read nx-refresh cookie → `verifyTokenFull` → reissue tokens
3. **Admin guard**: `(protected)/layout.tsx` reads nx-session cookie server-side → `verifyTokenFull` → redirect to `/admin/login` if invalid
4. **API protection**: Handlers call `requireAuth(request)` → throws `NxAuthError` if unauthorized; `requireCsrf(request)` on state-changing ops
5. **Invalidation**: `invalidateAllSessions` bumps `tokenVersion` in DB; all existing tokens become invalid

## CONVENTIONS

- Every server-entry route/layout must call `ensureCoreServices()` before using core APIs.
- Plugin routes are proxied at `/api/plugins/[pluginId]/[...path]` — `ensurePluginsLoaded()` is called before dispatch.
- Collection API routes call `ensureReady()` from collection-helpers (which calls both `ensureCoreServices` + `ensurePluginsLoaded`).
- `next.config.ts`: `transpilePackages` for UI packages, `serverExternalPackages` for core + native modules. Do not swap these.

## ANTI-PATTERNS

- **Never import `@nexpress/core` in client components** — only in server components, layouts, and API routes.
- **Never import `@nexpress/admin` from `(site)/*`** — leaks admin bundle to public pages.
- **Never edit `src/db/generated/collections.ts`** — it is auto-generated. Edit collection configs and re-run generators.
- **Never create a second DB connection** — use `getDb()` from bootstrap. One pool per process.
