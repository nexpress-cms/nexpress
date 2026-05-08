---
"create-nexpress": minor
---

**Phase 25.3 — `create-nexpress` scaffold uses `@nexpress/auth-pages` + Mailpit out of the box.**

New scaffolds (`pnpm create nexpress my-site`) ship with the
factory-based auth pattern from #535/#538 instead of hand-coded
route bodies, and the docker-compose template includes Mailpit
so register / forgot-password emails capture at
http://localhost:8025 immediately on `pnpm dev`.

### Templates

- **New `src/lib/auth-routes.ts`** — bootstraps
  `createStaffAuthRoutes()` once. Each `app/api/auth/<flow>/
  route.ts` re-exports the matching member as a 2-line file.
  Comment in the template walks operators through adding
  member auth (`createMemberAuthRoutes`) when they need it.
- **`api/auth/{login,logout,me}/route.ts`** — replaced with
  factory re-exports (was 30–130 lines of hand-coded SQL +
  cookie wiring; now 2 lines each).
- **`docker/docker-compose.yml`** — adds the Mailpit service
  alongside Postgres. SMTP `:1025` + browser inbox
  `http://localhost:8025`. Auto-accepts any auth credentials
  in dev mode.
- **`.env.example`** — `NP_EMAIL_ADAPTER=smtp` + Mailpit
  defaults are now active (instead of the earlier
  Resend-as-commented placeholder). Comment block explains the
  swap-to-real-provider path.
- **`scripts/setup-server.ts`** (the `pnpm run setup` wizard
  writer) — appends the same SMTP block to the generated
  `.env`. New scaffolds get working email out of the box; no
  silent NoopEmailAdapter fallback.

### Stability

`@nexpress/auth-pages` is added as a top-level scaffold
dependency (`workspace:*` in local mode, `nexpressVersion`
otherwise). The CLI itself bumps to `minor` to flag the new
file in scaffolded projects.

### Test plan

- 4 new tests in `templates.test.ts`:
  - `lib/auth-routes.ts` exists and references
    `createStaffAuthRoutes`
  - All 3 staff route files are 2-line factory re-exports (assert
    legacy bodies are gone)
  - docker-compose ships Mailpit on the right ports
  - `.env.example` points SMTP at Mailpit

### What's NOT in this PR (defer)

- **Member auth route templates** — scaffold has never shipped
  member auth (it was apps/web-only). Adding member templates
  is a feature expansion, not a migration. Sites that want
  member auth follow the cookbook recipe.
- **Staff client form hook migration** — admin login client
  still hand-codes fetch logic in the scaffold. Same shape as
  the apps/web migration (#3b follow-up).
- **OAuth provider templates** — `@nexpress/oauth-providers`
  (#537 / unmerged at PR-open time) will get scaffold integration
  once it lands on main; hand-rolled `setup()` calls in the
  scaffold's `nexpress.config.ts` keep working in the meantime.
