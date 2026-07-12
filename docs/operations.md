# Operations Runbook

The landing page for operators in trouble. Most fires belong to one of the
specialist guides — this page is the index, plus the scenarios that don't
have a natural home in any single subsystem doc.

> If a check or recipe below has drifted from the code, file an issue
> with the symptom and the specific line that misled you. Runbooks rot
> faster than guides.

## Specialist guides

| Symptom                                              | Go to                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Worker silent, queue not draining, scheduled cron    | [jobs.md § 11 Operations Playbook](./jobs.md#11-operations-playbook)                         |
| RSC pages serving stale data after a write           | [caching.md](./caching.md)                                                                   |
| Need to wire pino/Sentry/Datadog                     | [observability.md](./observability.md)                                                       |
| Multi-node rate-limiting, sticky sessions, S3 prereq | [deployment.md § Multi-node notes](./deployment.md#multi-node-notes)                         |
| `INTERNAL_ERROR` with no handler context             | [observability.md § Where errors get reported](./observability.md#where-errors-get-reported) |
| Email never arrives                                  | [email.md](./email.md)                                                                       |
| Importer stuck, partial run, resume                  | [wordpress-import-guide.md](./wordpress-import-guide.md)                                     |

## Boot warnings

`@nexpress/core` emits structured warnings at boot for known-unsafe
configurations (Phase 22.2). Each warning ships a stable `check` id in
its log context so log search rules can target them.

| `check` id                  | Meaning                                                                                                                                                                 | Fix                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multi_node_local_storage`  | `NP_STORAGE_ADAPTER=local` plus `NP_MULTI_NODE=true` / `=1`, `NP_REPLICAS>1`, or a production managed-container hint. Each node has its own `./uploads` dir.            | Switch to S3 (`NP_STORAGE_ADAPTER=s3` + bucket env). For migration of existing files, see [Switching storage adapters](#switching-storage-adapters) below. Use `NP_MULTI_NODE=false` / `NP_REPLICAS=1` only for deliberate single-node deploys.    |
| `missing_prod_secret`       | `NODE_ENV=production` AND `NP_SECRET` unset. JWT sessions are forgeable.                                                                                                | Generate a secret (`openssl rand -base64 48`) and set `NP_SECRET`. Existing sessions will be invalidated; users re-login.                                                                                                                          |
| `weak_prod_secret`          | `NP_SECRET` is shorter than 32 characters in production.                                                                                                                | Same fix as above.                                                                                                                                                                                                                                 |
| `noop_email_in_prod`        | `NODE_ENV=production` AND `NP_EMAIL_ADAPTER` is unset / `noop`. Transactional mail (password-reset, email-verify, member digests) is silently dropped.                  | Set `NP_EMAIL_ADAPTER=smtp` and the `NP_SMTP_*` env vars (or install a custom adapter via `setEmailAdapter()` in your bootstrap — see [email.md](./email.md)).                                                                                     |
| `loopback_database_in_prod` | `NODE_ENV=production` AND `DATABASE_URL` host is `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`. Almost always a stale dev connection string that slipped through CI/CD. | Point `DATABASE_URL` at the production Postgres instance.                                                                                                                                                                                          |
| `missing_site_url`          | `NODE_ENV=production` AND `SITE_URL` is unset. Sitemap, OAuth callbacks, email links all anchor on it.                                                                  | Set `SITE_URL` to your public origin (e.g. `https://example.com`). Note: with `SITE_URL` unset, password-reset / register / verify flows refuse to run (#598) — see [SITE_URL is required for email flows](#site_url-is-required-for-email-flows). |
| `loopback_site_url`         | `NODE_ENV=production` AND `SITE_URL` is `http://localhost:…` or similar loopback. Breaks share links, OAuth round-trips, outbound email.                                | Same fix.                                                                                                                                                                                                                                          |

These are warnings, not crashes — the process boots. They show up in
whatever logger has been installed via `setLogger()`; on a default
deploy that's stdout via `consoleLogger`. Verify them at runtime via
the `/admin/health` page (which mirrors the boot-time checks).

## Admin ops cockpit

Logged-in admins with `admin.manage` can start from `/admin/ops` when they
need the GUI equivalent of the deploy-readiness command set. The page combines
runtime health, deploy readiness, worker posture, storage evidence, and plugin
evidence into one action queue.

- `/admin/ops` — overview and release-handoff commands.
- `/admin/health` — runtime probes with copyable remediation commands and
  downloadable JSON evidence from `/api/admin/ops/health`.
- `/admin/readiness?target=vercel` — deploy gate for `vercel`, `railway`,
  `render`, `fly`, or `docker`; JSON evidence lives at
  `/api/admin/ops/readiness?target=<host>`.
- `/api/admin/ops/status` and `/api/admin/ops/doctor?prod=1&target=<host>&fixPlan=1`
  — remote read-only versions of the local `ops status` and production doctor
  JSON contracts.
- `/api/admin/ops/jobs`, `/api/admin/ops/storage`, and `/api/admin/ops/plugins`
  — read-only focused evidence snapshots for the runtime worker, media storage,
  and loaded plugin registry. These require an authenticated admin with
  `admin.manage`, just like the human ops pages.

Use the admin pages for human triage, then copy the matching `pnpm run ops:*`
or `pnpm --silent run ops:release ... --json` command when CI, an agent handoff,
or a runbook needs a stable artifact.

## SITE_URL is required for email flows

Three routes refuse to run when `SITE_URL` is unset, returning a 500
`Error` instead of leaking attacker-controlled host headers into
user-deliverable URLs:

- `POST /api/auth/forgot-password`
- `POST /api/members/forgot-password`
- `POST /api/members/register`

Symptom: operators see "Error: SITE_URL is unset — refusing to build a
user-deliverable URL from the request `Host` header." in their server
logs, and the affected forms surface a generic error.

Fix: set `SITE_URL` to your public origin in `.env`. The boot-warning
table above flags this same misconfiguration; the runtime refusal is
the strictness level for security-sensitive flows.

This is a deliberate hardening (#598) — without it, an attacker can
spoof `Host: attacker.example` on a forgot-password POST and cause
the framework to mail a real reset token inside an
`https://attacker.example/...` URL.

## OAuth provider button missing on login

Symptom: GitHub or Google does not appear on `/admin/login` or
`/members/login`, or the OAuth start route reports an unknown provider.

First run doctor with a fix plan:

```bash
pnpm run doctor -- --fix-plan
pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan
```

The blocking `settings.contract` check validates every `np_sites` record and
registered `np_settings` value. Unknown keys, malformed exact objects, and
invalid versioned envelopes must be repaired or removed before startup;
runtime reads deliberately do not reset them to defaults.

For bundled providers, set credentials from one source only:

- Env: set both `NP_OAUTH_GITHUB_CLIENT_ID` and
  `NP_OAUTH_GITHUB_CLIENT_SECRET`, or both
  `NP_OAUTH_GOOGLE_CLIENT_ID` and `NP_OAUTH_GOOGLE_CLIENT_SECRET`.
- Admin form: leave that provider's env pair unset and fill
  `/admin/plugins/oauth-github` or `/admin/plugins/oauth-google`.

Partial env is a configuration error. The plugin refuses to register
instead of mixing env and DB credentials, and doctor reports
`oauth.github.credentials` or `oauth.google.credentials` with the
missing variable. After saving admin-form credentials, click
**Reload all** in `/admin/plugins` or restart the process so plugin
setup registers the provider.

Callback URLs must match `SITE_URL` exactly. GitHub OAuth Apps accept
one Authorization callback URL, so the bundled GitHub plugin exposes
the provider on one login Audience at a time (`staff` by default, or
`member`). Register the matching callback URL for that Audience.
Google OAuth web clients can register both staff and member redirect
URIs.

## Migration crashed mid-flight

Symptoms: `pnpm db:migrate` exits non-zero; subsequent boots fail on a
table that's half-created or has columns the code doesn't expect.

1. Check the `drizzle.__drizzle_migrations` table. The last row is the
   latest _applied_ migration; if its hash matches the file you tried
   to apply, the failure was after the SQL committed and you can
   probably re-run `pnpm db:migrate` (it'll skip the already-applied
   row).
2. If the SQL didn't commit (transactional migration), `drizzle-kit`
   will offer to retry. Inspect the partial state with `psql`. If a
   table was created but the `INSERT` to seed it failed, you may need
   to drop the table manually and let the migration re-create it.
3. Never edit `drizzle.__drizzle_migrations` by hand to "fix" a state
   mismatch. If the schema and the migration table genuinely diverge,
   the right path is a new migration that asserts the desired state
   with `IF EXISTS` / `IF NOT EXISTS` clauses, not a manual rewrite.
4. After recovery, run `pnpm typecheck` — if generated code under
   `src/db/generated/` (`apps/web/src/db/generated/` in the monorepo)
   is stale, regenerate with `pnpm db:generate` (review the SQL diff
   before applying).

## Switching storage adapters

Going from `local` → `s3` (or vice versa) does **not** automatically
move existing files. The DB stores the storage key, not the URL —
`createStorageAdapter` resolves URLs at read time. Steps:

1. Sync the `./uploads` tree to the bucket:
   `aws s3 sync ./uploads s3://my-bucket/`.
2. Set `NP_STORAGE_ADAPTER=s3` + `NP_S3_BUCKET` + `NP_S3_REGION` and
   restart.
3. Spot-check a handful of media items via the admin Media surface —
   the URLs should resolve through your CDN/bucket origin now.
4. Once verified, the local `./uploads` directory can be archived.
   Keep it for one rollback window before deleting.

The boot warning `multi_node_local_storage` will silence itself once
the adapter flips.

## Forced sign-out for one user

Use this when a single account is compromised — leaked password, lost
device, departing employee with active sessions. It invalidates every
JWT issued for that user across every instance, but leaves all other
users untouched. Rotating `NP_SECRET` (below) is the wider hammer for
suspected secret leakage.

The mechanism is a `tokenVersion` column on `np_users`. Every JWT
encodes the version it was minted against; `verifyTokenFull` re-reads
the row on each request and rejects tokens whose version no longer
matches. Bumping the column forces re-authentication on the user's
next request, on every instance.

```bash
# By user id (preferred — no email lookup race).
psql "$DATABASE_URL" -c "
  UPDATE np_users
  SET token_version = token_version + 1
  WHERE id = 'a1b2c3d4-…';
"

# By email — convenient for ops but loses to a concurrent email change.
psql "$DATABASE_URL" -c "
  UPDATE np_users
  SET token_version = token_version + 1
  WHERE email = 'compromised@example.com';
"

# Optional cleanup — drop persisted refresh sessions for the same user.
# Not strictly required (the bump invalidates them too) but good hygiene.
psql "$DATABASE_URL" -c "
  DELETE FROM np_sessions WHERE user_id = 'a1b2c3d4-…';
"
```

Programmatic equivalent — call `invalidateAllSessions(userId, db)`
from `@nexpress/core/auth`. It does both the bump and the session
delete in a single transaction. The integration test in
`apps/web/tests/token-revocation.integration.test.ts` confirms the
multi-instance behaviour: a bump on instance A rejects the previously-
issued JWT on instance B's next request.

For members (separate `np_members` table with its own `token_version`
column), the same shape applies — update `np_members.token_version`
and clear the relevant `np_member_sessions` rows.

## Rotating `NP_SECRET`

Rotating the JWT signing secret invalidates every existing session.
Plan for a forced re-login.

1. Generate a new secret. Stage it in the new env config but do not
   deploy yet.
2. Communicate the planned cutover window if your sessions are
   long-lived (default 30 days).
3. Deploy with the new `NP_SECRET`. Every active user gets logged out
   on their next request.
4. There's no overlap window in v1 — the singleton secret is the only
   key that signs and verifies. Multi-key rollover is a future
   feature.

## DB connection saturation

Symptoms: `Error: connection terminated unexpectedly`, slow request
tails, pg `too many connections` in the server log.

1. Inspect the connection mix:
   `SELECT count(*), state FROM pg_stat_activity GROUP BY state;`.
   `idle in transaction` rows usually point to a route that forgot to
   release a transaction.
2. The `getDb()` singleton is the only intended pool per process
   (`AGENTS.md` ANTI-PATTERNS: never create parallel connections).
   `grep` for `new Pool` / `createDbConnection` outside
   `packages/core/src/db/runtime.ts` and `packages/next/src/bootstrap.ts`
   — there should be no other call sites.
3. If you've recently added a new long-running route, make sure it
   releases the connection (`finally` block or a transaction wrapper).
4. Bumping the pool size (`pg.Pool({ max })`) is a last resort — the
   default is conservative for a reason. Trace the leak first.

## S3 credentials rotation

Static credentials (access key + secret) — rotate via your IAM rotation
workflow, then update the deployment env (`NP_S3_*`). The S3 adapter
re-reads its credentials on construction, which happens once per
process — operators must restart all nodes after rotating. There's no
hot-reload of S3 credentials in v1.

For instance-profile (IRSA / EC2) credentials, the AWS SDK refreshes
on its own; nothing on the NexPress side needs to change.

## Backup and restore

NexPress's source of truth is Postgres; `./uploads` (or the configured
S3 bucket) is the secondary store. They must be backed up together
and restored in order, otherwise the system is left referencing data
that isn't there. `np_revisions` is edit history, not a backup — a
row deleted by an admin is gone from the revisions table along with
the document.

For the full procedure (cadence guidance, `pg_dump` flags, restore
order, post-restore verification checklist, planned-maintenance
pattern, DR drill, and automation snippets), see the live guide:
**[`backup-restore.md`](backup-restore.md)**.

## Stuck in `(protected)` admin redirect loop

Symptom: `/admin` and `/admin/login` keep bouncing the user back and
forth.

- Confirm `NP_SECRET` is the same across all nodes. If a load
  balancer is fronting two nodes signed with different secrets,
  every other request will fail JWT verification.
- Clear the `np-session` cookie in the browser DevTools. A token
  signed with the previous `NP_SECRET` won't verify, but Next won't
  always volunteer a 401 — sometimes the redirect path runs first.
- Confirm `cookies()` resolves on the same domain as `SITE_URL`. A
  mismatched domain (e.g. `app.example.com` vs `example.com`)
  drops the cookie silently.

## Promoting a non-admin user

There's no "promote" UI for the first admin (intentional — the seed
script is the only way to create one). To promote an existing user:

```sql
UPDATE np_users SET role = 'admin' WHERE email = 'user@example.com';
```

Bumping `tokenVersion` at the same time forces a re-login with the
new role:

```sql
UPDATE np_users
SET role = 'admin', token_version = token_version + 1
WHERE email = 'user@example.com';
```

The user picks up the new capabilities on their next login.

## When in doubt

- Read the AGENTS.md "ANTI-PATTERNS (THIS PROJECT)" section at the
  repo root before any structural change. The list is short and
  every entry has bitten somebody.
- A failing test in CI is more trustworthy than a passing one
  locally — `pnpm test:integration` requires `TEST_DATABASE_URL`
  and skips silently if you forget. See [testing.md](./testing.md).
