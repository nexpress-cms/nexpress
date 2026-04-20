# NexPress Implementation Plan

> Created: 2026-04-20
> Based on: nexpress-core-design.md (A–P), plugin-system-design.md
> Status: Ready for execution

---

## Overview

6 phases, each independently testable. Build order follows package dependency graph:
`core → admin/editor/theme/blocks → cli → apps/web`

**Out of scope**: Stage 2/3 plugin sandbox, multi-node, OAuth/SSO, i18n, real-time collaboration.

---

## Phase 1: Monorepo Bootstrap

**Goal**: Establish the monorepo structure so that `pnpm install && pnpm build` succeeds with empty packages.

**Packages**: All (scaffolds only)

### Tasks

1.1. **Root workspace setup**
- Create `package.json` (name: `nexpress`, private: true, engines: node >=20)
- Create `pnpm-workspace.yaml` referencing `packages/*` and `apps/*`
- Create `turbo.json` (see J.5)
- Create `.npmrc` (shamefully-hoist=false, strict-peer-dependencies=true)
- Create `.gitignore` (node_modules, .next, dist, .env, *.generated.ts)

1.2. **TypeScript configuration**
- Create root `tsconfig.base.json` (strict: true, target: ES2022, module: NodeNext, paths for @nexpress/*)
- Each package gets own `tsconfig.json` extending base

1.3. **Package scaffolds** — for each of these, create `package.json` + `tsconfig.json` + `src/index.ts` (empty export):
- `packages/core` — @nexpress/core
- `packages/admin` — @nexpress/admin
- `packages/editor` — @nexpress/editor
- `packages/blocks` — @nexpress/blocks
- `packages/theme` — @nexpress/theme
- `packages/plugin-sdk` — @nexpress/plugin-sdk
- `packages/cli` — create-nexpress
- `apps/web` — reference site (Next.js app)

1.4. **Docker setup**
- Create `docker/docker-compose.yml` (postgres:16-alpine + optional minio) — see J.4
- Create `docker/Dockerfile` (multi-stage build) — see J.4

1.5. **ESLint + Prettier**
- Create root `.prettierrc` (semi, singleQuote, trailingComma)
- Create root `eslint.config.mjs` (flat config, typescript-eslint, import boundaries: admin ✗→ site)

1.6. **Verification**
- `pnpm install` succeeds
- `pnpm build` succeeds (empty packages, turbo pipeline resolves)
- `docker compose up db` starts PostgreSQL, `pg_isready` passes
- TypeScript: `pnpm tsc --noEmit` passes in all packages

### Exit Criteria
- QA-J2: `pnpm install && pnpm build` succeeds
- QA-J4: Turbo pipeline order correct (core → admin/editor/theme/blocks → cli → apps/web)
- Docker PostgreSQL healthy

---

## Phase 2: Core — Config, DB Schema, Auth

**Goal**: `@nexpress/core` can define collections, generate Drizzle schemas, run migrations, and handle authentication.

**Packages**: `packages/core`
**Depends on**: Phase 1

### Tasks

2.1. **Config system** (Section B.1–B.3, J.2)
- Implement `defineConfig()` — validates and returns typed NxConfig
- Implement `defineCollection()` — validates and returns typed NxCollectionConfig
- Implement field type definitions: text, richText, number, select, checkbox, date, email, url, slug, relationship, upload, array, json, point, color, code (16 types, Section B.3)
- Export all from `packages/core/src/index.ts`

2.2. **Schema generation** (Section A.1–A.7, B.5)
- Implement `generateDrizzleSchema(collections)` — deterministic codegen
  - Base columns (A.3): id, status, createdAt, updatedAt, createdBy, updatedBy
  - Optional columns: slug (unique), _status (versions.drafts)
  - Field type → Drizzle column mapping (A.6): text→text, number→numeric, date→timestamp, select→text(enum), relationship→uuid+FK, upload→uuid+FK, richText→jsonb, array→child table, etc.
  - Child tables for array fields: `nx_c_{slug}__{field}` (A.6)
  - Join tables for hasMany relationships: `nx_c_{slug}__{field}` (A.6)
  - Search vector column (P.1): tsvector + GIN index
  - Media ref tracking (O.3): update nxMediaRefs on save
- Implement `generateTypeScript(collections)` — type codegen (B.6)
- CLI command: `db:generate` that writes `drizzle/schema.generated.ts`

2.3. **System tables** (Section A.4)
- Define static Drizzle schemas for: nxUsers, nxSessions, nxRevisions, nxSettings, nxNavigation, nxPlugins, nxMedia, nxMediaFolders, nxMediaRefs (O.3)
- Drizzle relations for all system tables (A.7)

2.4. **Database connection**
- Implement `createDbConnection(config)` using `drizzle-orm/node-postgres` + `pg` pool
- Connection pool config from `nexpress.config.ts` db options

2.5. **Auth system** (Section C.1–C.13)
- Token: `signToken()`, `verifyToken()` using jose (C.3)
- Password: `hashPassword()`, `verifyPassword()` using @node-rs/argon2 (C.4)
- Login handler: POST /api/auth/login (C.5) — argon2 verify, lockout, JWT+refresh+CSRF cookies
- Logout handler: POST /api/auth/logout (C.5) — delete session, clear cookies
- Middleware: `nxAuthMiddleware()` — Tier 1 JWT-only check (C.6, C.12)
- Full verification: `verifyTokenFull()` — Tier 2 DB check (C.8)
- Session invalidation: `invalidateAllSessions()` (C.8)
- Change password: PATCH /api/auth/change-password (C.9)
- Token refresh: POST /api/auth/refresh with rotation (C.10)
- CSRF: double-submit cookie pattern (C.11)
- Auth verification strategy: 3-tier documented (C.12)
- Access control: `NxAccessFunction`, built-in helpers (C.7)

2.6. **Runtime validation** (Section O.1)
- Implement `getCollectionZodSchema(collection)` — generates Zod schema from collection config at runtime
- Implement `buildZodSchema(field)` — maps each field type to Zod validator
- Used in saveDocument() Phase 1 validation

2.7. **Write pipeline** (Section L.1)
- Implement `saveDocument(collection, operation, data, user)` — 4-phase pipeline:
  - Phase 1: Zod validation (O.1)
  - Phase 2: beforeCreate/beforeUpdate hooks (sync, can abort)
  - Phase 3: DB transaction (Drizzle tx — insert/update + join tables + revisions + media refs + search vector)
  - Phase 4: Async side effects via job enqueue (afterCreate/afterUpdate hooks, cache invalidation, webhooks)
- Implement `deleteDocument(collection, id, user)` — with beforeDelete/afterDelete hooks
- Access control enforcement in pipeline (L.2)

2.8. **Collection API route handlers** (Section B.4)
- GET /api/collections/[slug] — list with pagination, sort, filter, search (P.1)
- GET /api/collections/[slug]/[id] — single document
- POST /api/collections/[slug] — create via saveDocument
- PATCH /api/collections/[slug]/[id] — update via saveDocument
- DELETE /api/collections/[slug]/[id] — delete via deleteDocument
- All handlers use Tier 2 auth + access control

2.9. **Background jobs** (Section M.1–M.3)
- Integrate pg-boss (in-process for v1)
- Define job types: media:processImage, media:cleanup, content:afterSave, system:revisionPrune, system:sessionCleanup
- Job handler registry
- Startup: `startWorker()` initializes pg-boss and registers handlers
- Cron schedules: revisionPrune (daily), sessionCleanup (hourly)

2.10. **Search** (Section P.1)
- Implement `buildSearchVector(collection, data)` — extracts text from fields (title, excerpt, rich text JSON)
- Integrate into saveDocument Phase 3 (update search_vector column)
- Integrate into list API handler (tsquery filter + ts_rank ordering)

### Exit Criteria
- QA-A1: Schema generation for posts collection matches expected
- QA-A3: Array field generates child table
- QA-A4: hasMany relationship generates join table
- QA-B1: All 16 field types generate correct columns
- QA-C1: Login succeeds with valid credentials
- QA-C2: Login rejected with wrong password, lockout after 5 attempts
- QA-C3: Middleware rejects unauthenticated /admin requests
- QA-L1: saveDocument atomic transaction (rollback on constraint violation)
- QA-L2: Zod validation rejects invalid input
- QA-L3: Access control denies unauthorized create
- QA-O1/O2: Runtime Zod validation works
- QA-P1: Full-text search returns ranked results

---

## Phase 3: Media, Theme, Import/Export

**Goal**: Media upload/processing pipeline works. Theme engine renders CSS custom properties. Import/export round-trips.

**Packages**: `packages/core` (media, theme, import/export), `packages/theme`
**Depends on**: Phase 2

### Tasks

3.1. **Storage adapters** (Section G.1–G.3)
- Implement `StorageAdapter` interface: upload, getUrl, exists, delete
- Implement `LocalStorageAdapter` — filesystem based
- Implement `S3StorageAdapter` — @aws-sdk/client-s3

3.2. **Media upload** (Section G.5–G.6, M.3)
- Upload handler: POST /api/media/upload — save original, insert DB (status: processing), enqueue job, return 202
- Media processing job handler: sharp pipeline (thumbnail, small, medium, large, og sizes)
- GET /api/media/[id] — return metadata
- DELETE /api/media/[id] — check nxMediaRefs, soft delete or 409

3.3. **Media library API**
- GET /api/media — list with pagination, folder filter
- Media folder CRUD
- Folder tree navigation

3.4. **Theme engine** (Section H.1–H.5)
- Implement `NxThemeTokens` type (H.2)
- Default token set: light + dark (H.3)
- `ThemeProvider` RSC component — generates CSS custom properties from DB tokens (H.4)
- `sanitizeTokenValue()` — CSS injection defense (N.3)
- Theme API: GET/PUT /api/settings/theme
- Base CSS with @layer (H.5): nx-base, nx-blocks, nx-theme, nx-overrides

3.5. **Import/Export** (Section I.4)
- POST /api/import — 4-phase pipeline: preflight → ID mapping → media matching → transactional write
- GET /api/export — dump NxSiteConfig JSON
- Idempotent slug-based upsert

3.6. **Settings & Navigation API**
- GET/PUT /api/settings — site settings CRUD
- GET/PUT /api/navigation — navigation items CRUD

### Exit Criteria
- QA-G1: Upload returns 202 with status: processing
- QA-G2: Image variants generated after job
- QA-G4: Delete unreferenced media soft-deletes
- QA-G4b: Delete referenced media blocked (409)
- QA-H1: Theme tokens render as CSS custom properties
- QA-I4–I10: Import/export round-trip, preflight rejection, idempotency, transaction, auth

---

## Phase 4: Editor, Blocks, Rendering

**Goal**: Lexical rich text editor works. Block page editor with drag-and-drop. Public site renders pages with ISR.

**Packages**: `packages/editor`, `packages/blocks`, `packages/theme`, `apps/web` (partial)
**Depends on**: Phase 3

### Tasks

4.1. **Lexical rich text editor** (Section F.2)
- `@nexpress/editor` package setup with @lexical/react
- NxRichTextEditor component: toolbar (bold, italic, heading, link, list, quote, code, image)
- Lexical feature plugin architecture
- Read-only SSR renderer: `renderRichText(content)` for public site

4.2. **Block page editor** (Section F.3)
- Block registry: register/lookup block definitions
- BlockPageEditor component: vertical block list with dnd-kit drag-and-drop
- Block toolbar: add, move, delete, duplicate
- Each block: config panel (fields) + preview
- Serialization: blocks → JSON array for storage

4.3. **Default blocks** (Section packages/blocks)
- Hero, FeatureGrid, FAQ, Pricing, CTA, RichText, ContactForm, ImageGallery
- Each block: React component (render) + config schema (fields) + admin preview

4.4. **Rendering layer** (Section D.1–D.4)
- Route groups: (site)/ for public, (admin)/ for admin
- Catch-all `[[...slug]]/page.tsx` for pages (K.4 — optional catch-all)
- `getPageBySlug()` — fetch page + blocks from DB
- `getPostBySlug()` — fetch post with status filter
- ISR: revalidateTag on content save (D.4)
- NxImage component (G, D) — responsive images with srcSet from media sizes
- Collection-specific routes: /blog/[slug]/page.tsx

4.5. **Public site layout**
- Site layout with ThemeProvider
- Navigation component (fetches from /api/navigation)
- Footer, header from settings

### Exit Criteria
- QA-F1: Rich text editor renders and saves Lexical JSON
- QA-F2: Block editor adds/reorders blocks
- QA-D1: SSR page renders blocks correctly
- QA-D2: No lexical JS chunks in public site network tab (SSR only)
- QA-K3: Homepage matches optional catch-all
- QA-K4: Nested page path resolves

---

## Phase 5: Admin UI

**Goal**: Full admin panel: dashboard, collection CRUD, media library, settings, theme editor.

**Packages**: `packages/admin`, `apps/web`
**Depends on**: Phase 4

### Tasks

5.1. **Admin shell** (Section E.1–E.3)
- AdminShell layout: sidebar + topbar + content area
- Sidebar navigation: dashboard, collections (dynamic), media, settings, plugins
- AuthProvider: session management, auto-refresh timer (C.12)
- Route: /admin/[...path] catch-all → admin router

5.2. **Collection views** (Section E.4–E.6)
- CollectionListView: paginated table, sort, filter, search, bulk actions
- CollectionEditView: auto-generated form from field config
- Field renderers for all 16 field types (Section E.6): TextFieldEditor, NumberFieldEditor, RichTextFieldEditor, SelectFieldEditor, RelationshipFieldEditor, UploadFieldEditor, ArrayFieldEditor, etc.
- Create/Edit form: validation feedback, save, publish/draft toggle

5.3. **Media library UI** (Section E.7, G)
- Grid/list view with thumbnails
- Folder navigation
- Upload via drag-drop
- Media picker modal (for relationship/upload fields)

5.4. **Dashboard** (Section E.3)
- Recent documents widget
- Quick actions (create post, upload media)
- System status (DB connection, storage, job queue)

5.5. **Settings UI**
- Site settings editor
- Theme editor with live preview (H.4)
- Navigation editor (drag-and-drop ordering)
- User management (CRUD, role assignment)

5.6. **Plugin admin page** (Section E, plugin-system-design Section 3)
- List installed plugins
- Plugin settings panels (per-plugin config)
- v1 trust warning banner (HS-2)

### Exit Criteria
- QA-E1: Admin login redirects to dashboard
- QA-E2: Collection list shows paginated data
- QA-E3: Create document via form succeeds
- QA-E4: Edit document loads existing data
- QA-G5: Media library UI: upload, browse, folder navigation
- QA-H2: Theme editor changes reflect on public site

---

## Phase 6: CLI, Plugin SDK, Polish

**Goal**: `npx create-nexpress my-site` works end-to-end. Plugin SDK published. Docker deployment tested.

**Packages**: `packages/cli`, `packages/plugin-sdk`, all (polish)
**Depends on**: Phase 5

### Tasks

6.1. **create-nexpress CLI** (Section J.1)
- Interactive prompts: project name, DB (local Docker / remote URL), storage, example content, Docker setup
- Scaffold generator: creates directory structure from J.1 template
- Post-scaffold: pnpm install, docker compose up db, pnpm db:generate, pnpm db:migrate, seed example content

6.2. **Plugin SDK** (plugin-system-design Section 1–5)
- `definePlugin()` — manifest + setup function
- NxPluginContext: registerHook, registerAction, registerBlock, registerWidget, registerApiRoute, registerScheduledTask
- Plugin registration in core: load from nexpress.config.ts plugins array
- Hook integration with saveDocument pipeline
- API route mounting: /api/plugins/[pluginId]/[...path]
- Scheduled task registration with pg-boss

6.3. **Routing contract enforcement** (Section K)
- NX_RESERVED_PATHS validation at config load time
- Plugin rootPath rewrites in next.config.ts (K.3)
- Slug collision warnings at build time

6.4. **Platform policies** (Section N)
- Security headers middleware (N.2): X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy
- Rate limiting on auth endpoints (N.2): 10 req/min per IP
- nxCache() wrapper for unstable_cache (N.6)
- Draft cache isolation: no-store for preview mode (N.7)
- Local storage multi-node warning (N.8)
- NxApiError standard format + nxErrorResponse() helper (N.1)

6.5. **Schema evolution tooling** (Section O.2)
- CLI warnings for field removal (data loss) and type change (manual migration required)
- Safe add: nullable column default

6.6. **Docker deployment**
- Verify multi-stage Docker build works
- Health check endpoint: GET /api/health
- Startup: auto-migrate on first boot

6.7. **End-to-end test**
- `npx create-nexpress test-site --yes` → full scaffold
- `docker compose up` → site running at localhost:3000
- Create admin user, login, create page, publish, verify public site renders
- "5분 안에 wow" verification

### Exit Criteria
- QA-J1: create-nexpress scaffolds project
- QA-J3: nexpress.config.ts validates
- QA-J5: Docker build + compose up succeeds, site accessible
- QA-J6: Dev server starts with hot reload
- QA-N1–N7: All platform policy scenarios pass
- QA-K1–K6: Routing contract enforced
- Full E2E: scaffold → deploy → content → public site

---

## Summary

| Phase | Focus | Key Packages | Estimated Effort |
|-------|-------|-------------|-----------------|
| 1 | Monorepo bootstrap | all (scaffolds) | Small |
| 2 | Core: config, DB, auth, CRUD, jobs | core | Large |
| 3 | Media, theme, import/export | core, theme | Medium |
| 4 | Editor, blocks, rendering | editor, blocks, apps/web | Large |
| 5 | Admin UI | admin, apps/web | Large |
| 6 | CLI, plugin SDK, polish | cli, plugin-sdk, all | Medium |
