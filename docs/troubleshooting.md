# Troubleshooting first-boot issues

This page covers the errors operators most commonly hit between
`npx create-nexpress my-site` and a working local dev server. Most
of them are environment / configuration issues, not code bugs —
NexPress's own bugs in this surface get fixed in the latest
`create-nexpress` (re-scaffold to pull them in).

Each entry is **symptom → diagnosis → fix**. Search this file for the
text in the symptom column.

## Database connection

### `psql ... database "<name>" does not exist` / `sqlstate 3D000`

**Diagnosis.** Postgres is reachable on the host/port, but the database
named in `DATABASE_URL` hasn't been created yet. The compose stack's
`POSTGRES_DB` env auto-creates the DB **only on the container's first
boot** — if you've previously brought the compose stack up with a
different `POSTGRES_DB` value, the existing volume retains the old
state and the auto-create skips.

**Fix.** Create the DB manually:

```bash
docker compose -f docker/docker-compose.yml exec db \
  psql -U nexpress -d postgres -c 'CREATE DATABASE "<name>"'
```

Or wipe the volume and bring compose back up so the auto-create fires
on a fresh data dir:

```bash
docker compose -f docker/docker-compose.yml down -v   # destroys data
docker compose -f docker/docker-compose.yml up -d db
```

### `password authentication failed for user "nexpress"` / `sqlstate 28P01` / `28000`

**Diagnosis.** Almost always a host-port collision. Another Postgres
instance (a previous scaffold's compose stack, a system-wide install,
or another tool's container) is already bound to the host port the
new scaffold wants. `docker compose up -d db` is a silent no-op
against the existing container, and connections from the new
scaffold land on the wrong database (whose `nexpress` user doesn't
exist or has different credentials).

**Fix.** Pick one:

- **Stop the conflicting service** (`docker compose down` in the
  other project's directory) and re-run this command here:

  ```bash
  docker compose -f docker/docker-compose.yml up -d db
  ```

- **Free a port for this scaffold**: edit `.env`, set
  `NEXPRESS_DB_PORT=<free port>` and update `DATABASE_URL`'s port
  to match, then re-run setup.

Since `0.3.6` the wizard's "Test connection" button scans for a free
port near the failing one and surfaces it as `Detected free port: <N>`
in the error message. The browser form also auto-fills the dbPort
input (or splices `DATABASE_URL`'s port in URL mode) so you can hit
"Test connection" again without retyping the recommendation. The
scaffold's compose template substitutes the project-specific port
as the `${NEXPRESS_DB_PORT:-…}` fallback, so even when `--env-file`
lookup misses (see below), the right port is used.

### `connect ECONNREFUSED 127.0.0.1:5433`

**Diagnosis.** Nothing is listening at the configured host/port.

**Fix.** Start the bundled Postgres:

```bash
docker compose -f docker/docker-compose.yml up -d db
```

Or point `DATABASE_URL` at a Postgres you already have running.

### Setup wizard shows port `<X>`, but `docker compose up` binds port `<Y>`

**Diagnosis.** Docker Compose's `--env-file` defaults to the
compose file's directory (the scaffold's `docker/`), NOT the
project root where `.env` lives. So `${NEXPRESS_DB_PORT}` in
the compose template doesn't get resolved from your `.env`.

**Status.** Fixed in `create-nexpress@0.1.22`+. The scaffold now
substitutes the project-specific port as the compose fallback at
scaffold time, so this collision can't happen on fresh scaffolds.

**Fix (existing scaffolds before 0.1.22).** Edit
`docker/docker-compose.yml` and replace `${NEXPRESS_DB_PORT:-5433}`
with `${NEXPRESS_DB_PORT:-<your unique port>}`. Or always run
compose with an explicit env-file: `docker compose --env-file .env
-f docker/docker-compose.yml up -d db`.

## Scripts

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib'`

Surfaces when running `pnpm run seed:content`, `pnpm run worker`,
or any other `tsx` script that transits through `@nexpress/app/lib/*`.

**Status.** Fixed in `create-nexpress@0.1.22`+. The scaffold's
`seed-content.ts` and `worker.ts` templates now bootstrap directly
via `createBootstrap` from `@nexpress/next` and don't go through
`@nexpress/app/lib/init-core`'s compiled chunks (which reference the
`@/lib/bootstrap` path alias `tsx` can't resolve inside
`node_modules`).

**Fix (existing scaffolds before 0.1.22).** Either re-scaffold, or
copy the new versions of `scripts/seed-content.ts` and
`scripts/worker.ts` from the
[CLI templates](../packages/cli/src/templates.ts) into your project.

### `Collection "posts" has no matching generated Drizzle table`

**Diagnosis.** You haven't run `pnpm db:generate` yet — the Drizzle
schema for the scaffold's collections doesn't exist on disk. The
bootstrap chain runs `ensureCoreServices()`, which tries to wire each
collection to its generated table, and fails when the table isn't
exported from `src/db/generated/collections.ts`.

**Fix.**

```bash
pnpm db:generate    # regenerates collections.ts + documents.ts
pnpm db:migrate     # applies the SQL migration
```

### `pnpm run seed:content`: "No admin user found"

**Diagnosis.** The scaffold needs at least one user with role
`admin` in `np_users` before it can attribute seeded content to
someone.

**Fix.** Either complete the first-boot setup wizard
(`pnpm run setup` → fill in the admin step), or seed an admin
non-interactively:

```bash
NP_ADMIN_EMAIL=admin@example.com \
  NP_ADMIN_PASSWORD=<at least 12 chars> \
  NP_ADMIN_NAME=Admin \
  pnpm run seed:admin
```

### `pnpm run seed:content`: "No active theme"

**Diagnosis.** No theme is recorded as active in `np_settings`. The
first-boot setup wizard writes one when the operator picks a theme;
if you skipped the wizard, no theme is active yet.

**Fix.** Pick a theme from the admin UI's Appearance page, or
re-run `pnpm run setup` and complete the theme step. For headless
installs, set `NP_ADMIN_THEME=<theme-id>` in `.env` and re-run
the wizard's first-boot path.

## Setup wizard

### "Unable to read current state" / 404 on `/api/admin/themes/reseed`

**Status.** Fixed in `create-nexpress@0.1.21`+. The scaffold's
snapshot was missing the `app/api/admin/themes/reseed/route.ts`
wrapper file — typecheck passed (the import target exists in
`@nexpress/app`), but Next's filesystem router had no route at the
URL the admin theme switcher's dialog calls, so the GET 404'd.

**Fix (existing scaffolds before 0.1.21).** Add two files to your
project, each a two-line re-export. See [PR #830](https://github.com/nexpress-cms/nexpress/pull/830)
for the exact contents:

- `src/app/api/admin/themes/reseed/route.ts`
- `src/app/api/newsletter/route.ts`

Or re-scaffold.

### Setup wizard's browser tab doesn't open automatically

**Diagnosis.** The CLI auto-detects HTTP vs CLI mode by checking
for `DISPLAY` / `WAYLAND_DISPLAY` / `SSH_TTY`. On some Linux
desktop environments the display env vars aren't inherited into
the shell that runs `pnpm run setup`, so the wizard falls back to CLI
mode silently.

**Fix.** Force HTTP mode with `pnpm run setup -- --no-cli`, or run
the CLI mode explicitly with `pnpm run setup -- --cli` if you prefer
the terminal flow.

## After the wizard completes but the site renders nothing

**Diagnosis.** The setup wizard creates the admin user + writes
`.env` but doesn't, by itself, seed sample content — the
demo pages/posts only land when you tick "Add sample content?"
during the wizard or run `pnpm seed:content` afterwards.

**Fix.** Either re-run setup and tick the box, or:

```bash
pnpm run seed:content  # seeds the active theme's demo pages/posts
```

## Still stuck?

- Run `pnpm run doctor` for a structured health-check of your `.env`,
  DB connection, migrations state, etc.
- Look in the project's `docker/docker-compose.yml`'s `mailpit`
  service inbox at <http://localhost:8025> — verification emails,
  password-reset emails, and notification mails all land there
  during dev.
- Check [open issues](https://github.com/nexpress-cms/nexpress/issues)
  or file a new one with the output of `pnpm run doctor` + the failing
  command's full stderr.
