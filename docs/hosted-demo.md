# Hosted Demo

This page is the operating spec for the public NexPress hosted demo. The demo
must prove the same path a new operator uses: start from the published
`create-nexpress` package, connect managed infrastructure, deploy, and let a
visitor safely try the Admin UI.

## Goals

- Build the demo from the latest published `create-nexpress` package, not from
  a workspace checkout.
- Keep the public site inspectable without a login.
- Let visitors try the Admin UI with a real session and real writes.
- Reset all visitor changes automatically so the demo stays healthy.
- Make every deployment step reproducible from documented commands.

## Non-goals

- Do not expose a production admin account with durable authority.
- Do not let visitors manage users, secrets, outbound integrations, imports, or
  destructive operations.
- Do not make the monorepo `apps/web` deployment the demo. The point is to
  validate the scaffolded-site path.
- Do not promise persistent visitor content.

## Shape

Use a separate demo repository generated from the published scaffolder:

```bash
npx create-nexpress@latest nexpress-demo
cd nexpress-demo
pnpm install
pnpm run deploy:plan -- --target vercel
pnpm run doctor:prod -- --target vercel
```

Recommended hosting:

| Surface  | Choice                             | Notes                                                      |
| -------- | ---------------------------------- | ---------------------------------------------------------- |
| Web      | Vercel                             | Fastest public path and matches the scaffold README.       |
| Database | Neon, Supabase, or Vercel Postgres | Must support scheduled reset writes.                       |
| Media    | R2, S3, or compatible store        | Vercel filesystem is ephemeral. Use a `demo/` prefix.      |
| Worker   | Deferred for v1                    | Vercel cron is enough for reset and scheduled HTTP checks. |

## Public Site Content

The public site should show more than a blank blog:

- Home page with a concise NexPress value statement.
- Blog index and several posts using rich text and media.
- A page-builder page with repeated blocks: callout, latest posts, pricing,
  stats, newsletter, and embed where available.
- A plugin showcase page that names bundled plugins and what each demonstrates.
- A short "Try the Admin" page that explains the reset window and links to the
  demo login.

The content pack should be deterministic. Re-running the reset should recreate
the same pages, posts, navigation, active theme, plugin config, and sample media
references.

## Admin Demo Model

Start with a shared reset-style Admin demo. It is less isolated than per-session
sandboxes, but it is simple, transparent, and good enough for first public use.

Flow:

1. Visitor opens `/admin/demo-login`.
2. The route only works when `NP_DEMO_MODE=1`.
3. The route creates or reuses a demo staff user and issues a normal admin
   session cookie.
4. The visitor lands in `/admin` with a persistent banner:
   `Demo mode: changes reset every 30 minutes`.
5. A scheduled reset restores the site to the seed snapshot.

The demo account should be allowed to exercise normal content authoring:

- create and edit posts/pages
- upload media under the demo storage prefix
- preview and publish content
- edit navigation and non-secret theme settings
- inspect plugin admin surfaces that do not perform outbound work

The demo account must not be able to:

- manage users or super-admin state
- edit OAuth, SMTP, webhook, or storage secrets
- run arbitrary plugin actions that call external hosts
- start imports, exports, or destructive cleanup jobs
- change site membership or cross-site access
- change scheduler tokens, database settings, or production readiness config
- delete the active site or reset baseline rows manually

## Capability Contract

Prefer a structural demo guard over fragile UI-only hiding.

- Gate demo behavior behind `NP_DEMO_MODE=1`.
- Use a stable demo marker, for example `np_users.email = demo@nexpress.local`
  plus a server-side helper such as `isDemoPrincipal(principal)`.
- Enforce restrictions in API routes and server actions, not only in React
  components.
- Keep normal capabilities intact for real admins. Demo restrictions are an
  additional deny layer.
- Return `403` with a clear code/message when a demo user hits a disabled
  surface.

The first implementation can live in the scaffolded demo app if that keeps the
framework surface smaller. Promote reusable pieces into packages only after the
demo proves the shape.

## Reset Contract

Reset cadence:

- every 30 minutes for the shared public demo
- manually triggerable by an operator
- idempotent, so overlapping cron runs do not corrupt state

Reset scope:

- content collections
- navigation
- active theme and theme settings
- plugin config rows safe for public viewing
- demo user session version
- media rows and objects under the demo prefix
- job rows created by demo activity, where safe to prune

Reset must not touch:

- operator admin accounts
- production secrets
- migration tables
- database connection state
- non-demo storage prefixes

Implementation options:

- A `pnpm demo:reset` script in the demo repo.
- A protected `POST /api/internal/demo-reset` route called by Vercel Cron.
- A small lock row or advisory lock to prevent concurrent resets.

## Environment

Required:

```bash
DATABASE_URL=
NP_SECRET=
SITE_URL=
NP_STORAGE_ADAPTER=s3
NP_S3_BUCKET=
NP_S3_REGION=
NP_DEMO_MODE=1
NP_DEMO_RESET_TOKEN=
```

Recommended:

```bash
NP_S3_ENDPOINT=        # R2 / MinIO / non-AWS S3
NP_SCHEDULER_TOKEN=   # if scheduled publishing is shown
```

`pnpm run doctor:prod -- --target vercel` must pass before publishing the demo
URL.

## Security Checklist

- Demo login disabled unless `NP_DEMO_MODE=1`.
- Demo login issues only the demo principal, never an operator account.
- Demo restrictions enforced server-side.
- Demo admin banner visible on every protected Admin page.
- Secret-bearing forms disabled or redacted for demo users.
- Outbound plugin examples disabled or configured to local/no-op sinks.
- Reset token stored only in host secrets.
- Media cleanup limited to the configured demo prefix.
- Admin audit log records demo login and reset events.

## Milestones

1. **Plan and contract**: this document plus README/docs links.
2. **Published scaffold smoke**: create a fresh app from
   `create-nexpress@latest`, run setup/build/doctor, and record gaps.
3. **Demo content pack**: deterministic seed/reset script for public pages,
   navigation, theme settings, plugins, and media.
4. **Shared Admin Demo**: demo login, capability deny layer, admin banner, and
   scheduled reset.
5. **Hosted deploy**: Vercel project, managed Postgres, S3-compatible media,
   production doctor pass, public URL in README.
6. **Hardening**: per-session sandboxes if shared reset behavior becomes too
   noisy.

## Success Criteria

- The demo was generated from a published `create-nexpress` version.
- Public pages render real NexPress content and media.
- A visitor can log into Admin, edit content, preview, and publish.
- Restricted demo actions fail safely.
- The demo resets automatically without operator intervention.
- The deployment can be rebuilt from the documented env and commands.
