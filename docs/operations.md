# Operations Runbook

The landing page for operators in trouble. Most fires belong to one of the
specialist guides — this page is the index, plus the scenarios that don't
have a natural home in any single subsystem doc.

> If a check or recipe below has drifted from the code, file an issue
> with the symptom and the specific line that misled you. Runbooks rot
> faster than guides.

## Specialist guides

| Symptom                                              | Go to                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Worker silent, queue not draining, scheduled cron    | [jobs.md § 11 Operations Playbook](./jobs.md#11-operations-playbook) |
| RSC pages serving stale data after a write           | [caching.md](./caching.md)                                 |
| Need to wire pino/Sentry/Datadog                     | [observability.md](./observability.md)                     |
| Multi-node rate-limiting, sticky sessions, S3 prereq | [deployment.md § Multi-node notes](./deployment.md#multi-node-notes) |
| `INTERNAL_ERROR` with no handler context             | [observability.md § Where errors get reported](./observability.md#where-errors-get-reported) |
| Email never arrives                                  | [email.md](./email.md)                                     |
| Importer stuck, partial run, resume                  | [wordpress-import-guide.md](./wordpress-import-guide.md)   |

## Boot warnings

`@nexpress/core` emits structured warnings at boot for known-unsafe
configurations (Phase 22.2). Each warning ships a stable `check` id in
its log context so log search rules can target them.

| `check` id                  | Meaning                                                                                  | Fix                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `multi_node_local_storage`  | `NX_MULTI_NODE=true` (or `=1`) AND `NX_STORAGE_ADAPTER=local`. Each node has its own `./uploads` dir. | Switch to S3 (`NX_STORAGE_ADAPTER=s3` + bucket env). For migration of existing files, see [Switching storage adapters](#switching-storage-adapters) below.                              |
| `missing_prod_secret`       | `NODE_ENV=production` AND `NX_SECRET` unset. JWT sessions are forgeable.                  | Generate a secret (`openssl rand -base64 48`) and set `NX_SECRET`. Existing sessions will be invalidated; users re-login.                                                                |
| `weak_prod_secret`          | `NX_SECRET` is shorter than 32 characters in production.                                  | Same fix as above.                                                                                                                                                                   |

These are warnings, not crashes — the process boots. They show up in
whatever logger has been installed via `setLogger()`; on a default
deploy that's stdout via `consoleLogger`.

## Migration crashed mid-flight

Symptoms: `pnpm db:migrate` exits non-zero; subsequent boots fail on a
table that's half-created or has columns the code doesn't expect.

1. Check the `drizzle.__drizzle_migrations` table. The last row is the
   latest *applied* migration; if its hash matches the file you tried
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
   `apps/web/src/db/generated/` is stale, regenerate with
   `pnpm db:generate` (review the SQL diff before applying).

## Switching storage adapters

Going from `local` → `s3` (or vice versa) does **not** automatically
move existing files. The DB stores the storage key, not the URL —
`createStorageAdapter` resolves URLs at read time. Steps:

1. Sync the `./uploads` tree to the bucket (`aws s3 sync ./uploads
   s3://my-bucket/`).
2. Set `NX_STORAGE_ADAPTER=s3` + `NX_S3_BUCKET` + `NX_S3_REGION` and
   restart.
3. Spot-check a handful of media items via the admin Media surface —
   the URLs should resolve through your CDN/bucket origin now.
4. Once verified, the local `./uploads` directory can be archived.
   Keep it for one rollback window before deleting.

The boot warning `multi_node_local_storage` will silence itself once
the adapter flips.

## Rotating `NX_SECRET`

Rotating the JWT signing secret invalidates every existing session.
Plan for a forced re-login.

1. Generate a new secret. Stage it in the new env config but do not
   deploy yet.
2. Communicate the planned cutover window if your sessions are
   long-lived (default 30 days).
3. Deploy with the new `NX_SECRET`. Every active user gets logged out
   on their next request.
4. There's no overlap window in v1 — the singleton secret is the only
   key that signs and verifies. Multi-key rollover is a future
   feature.

## DB connection saturation

Symptoms: `Error: connection terminated unexpectedly`, slow request
tails, pg `too many connections` in the server log.

1. Inspect `SELECT count(*), state FROM pg_stat_activity GROUP BY
   state;` — `idle in transaction` rows usually point to a route that
   forgot to release a transaction.
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
workflow, then update the deployment env (`NX_S3_*`). The S3 adapter
re-reads its credentials on construction, which happens once per
process — operators must restart all nodes after rotating. There's no
hot-reload of S3 credentials in v1.

For instance-profile (IRSA / EC2) credentials, the AWS SDK refreshes
on its own; nothing on the NexPress side needs to change.

## Backup and restore

NexPress's source of truth is Postgres. The `./uploads` directory (or
S3 bucket, with versioning) is the secondary store.

1. **Postgres** — `pg_dump` is the supported backup format. Restore
   with `pg_restore` against an empty database, then bring up
   NexPress against the restored DB. Schema migrations are tracked in
   `drizzle.__drizzle_migrations`; they restore with the dump.
2. **Media (S3)** — enable bucket versioning. Restore a deleted file
   by reverting the latest delete marker; restore a corrupted file by
   selecting an earlier version.
3. **Media (local)** — back up the `./uploads` directory along with
   the DB, on the same cadence. Restoring half (DB but not files, or
   vice versa) leaves the system in an inconsistent state where
   media references point at missing keys.

The data pipeline already tracks revisions in `nx_revisions` — that's
edit history, not a backup. A row deleted by an admin is gone from
the revisions table too.

## Stuck in `(protected)` admin redirect loop

Symptom: `/admin` and `/admin/login` keep bouncing the user back and
forth.

- Confirm `NX_SECRET` is the same across all nodes. If a load
  balancer is fronting two nodes signed with different secrets,
  every other request will fail JWT verification.
- Clear the `nx-session` cookie in the browser DevTools. A token
  signed with the previous `NX_SECRET` won't verify, but Next won't
  always volunteer a 401 — sometimes the redirect path runs first.
- Confirm `cookies()` resolves on the same domain as `SITE_URL`. A
  mismatched domain (e.g. `app.example.com` vs `example.com`)
  drops the cookie silently.

## Promoting a non-admin user

There's no "promote" UI for the first admin (intentional — the seed
script is the only way to create one). To promote an existing user:

```sql
UPDATE nx_users SET role = 'admin' WHERE email = 'user@example.com';
```

Bumping `tokenVersion` at the same time forces a re-login with the
new role:

```sql
UPDATE nx_users
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
