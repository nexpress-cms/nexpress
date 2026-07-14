# Backup and restore

This is the operational guide for backing up and restoring a NexPress
deployment. The runbook entry in [`operations.md`](operations.md#backup-and-restore)
is the incident-time pointer; this document is the full procedure for
planned backups, scheduled restores, and disaster-recovery drills.

## What you're protecting

NexPress has two stores of record. They must be backed up together and
restored in order, otherwise the system is left referencing data that
isn't there.

| Store             | What it holds                                                       | Backup mechanism             |
| ----------------- | ------------------------------------------------------------------- | ---------------------------- |
| **Postgres**      | Users, content, revisions, jobs, settings, audit log, media records | `pg_dump`                    |
| **Media storage** | The actual binary files referenced by `np_media.path`               | S3 versioning OR file backup |

The Postgres tables `np_media` (media records) and `np_media_refs`
(content → media references) are what tie the two stores together. A
restore that brings DB rows back without their files leaves the admin
showing 404s for every image; the inverse leaves orphaned files that
nothing references.

The data pipeline tracks edit history in `np_revisions`. That is **not
a backup** — it's the per-document version history exposed in the admin
UI. A row deleted by an admin is gone from `np_revisions` along with
the document.

## Backup cadence

Pick the cadence that matches your RPO (recovery point objective — how
much data you're willing to lose) and RTO (recovery time objective —
how long you can be down).

| RPO target | DB cadence            | Media cadence                 |
| ---------- | --------------------- | ----------------------------- |
| < 1 hour   | streaming replication | S3 versioning + replication   |
| < 1 day    | hourly `pg_dump`      | S3 versioning OR hourly rsync |
| < 1 week   | nightly `pg_dump`     | nightly rsync                 |

For most self-hosted deploys, **nightly `pg_dump` + S3 versioning** is
the sweet spot: simple, durable, and the restore procedure is the same
as the disaster-recovery drill.

## Postgres backup

### Dump

The supported backup format is `pg_dump --format=custom`. The custom
format is compressed, supports parallel restore, and lets you skip or
include individual tables on restore.

```bash
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="nexpress-$(date +%Y%m%d-%H%M%S).dump"
```

- `--no-owner` and `--no-privileges` make the dump portable across
  database users — critical when the restore target uses different
  credentials than the source (e.g. moving from RDS to Cloud SQL).
- The dump includes the `drizzle.__drizzle_migrations` migration log,
  so a restored database is at the same migration version as the
  source. **Don't run `pnpm db:migrate` after restoring.**

### What's in the dump

The dump captures every NexPress table. The ones that matter for
disaster recovery:

| Table family                      | Why it matters                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `np_users`, `np_sessions`         | Staff accounts and one access/refresh pair per browser session.                  |
| `np_members`, `np_member_*`       | Member accounts, identities, and paired browser sessions.                        |
| `np_c_*`                          | Collection content (posts, pages, taxonomies, discussions, …).                   |
| `np_revisions`                    | Per-document version history.                                                    |
| `np_media`, `np_media_refs`       | Media records and their content references — must match the file store.          |
| `np_settings`                     | Site settings, active theme, plugin enable/disable.                              |
| `np_audit_events`                 | Compliance log; required for forensic review of past incidents.                  |
| `np_navigation`                   | Header / footer menus per site.                                                  |
| `np_sites`, `np_site_memberships` | Multi-tenant configuration; preserves per-site staff mappings.                   |
| `np_plugin_storage`               | Plugin-owned data; restoring without it can leave plugins in inconsistent state. |
| `np_worker_heartbeats`            | Job worker liveness; ignored on restore (next worker start overwrites).          |

The pg-boss tables (`job`, `job_common`, `archive`, …) restore along
with the rest. Jobs that were in flight at backup time will be
re-attempted by the worker after the restore comes online — make sure
your handlers are idempotent (they should be already; see
`docs/jobs.md`).

### Verifying the dump

A backup that hasn't been restored is a backup you don't have.

```bash
# Quick integrity check — won't actually restore
pg_restore --list nexpress-20260502-030000.dump | head
```

For a real verification, restore into a throwaway database every
quarter (the [DR drill](#disaster-recovery-drill) section below).

## Media backup

### S3 (recommended for production)

Enable versioning on the bucket _before_ you start writing to it.
Versioning is what makes "delete a file" recoverable — without it, a
delete is permanent.

```bash
aws s3api put-bucket-versioning \
  --bucket "$NP_S3_BUCKET" \
  --versioning-configuration Status=Enabled
```

Combine versioning with cross-region replication if you need
geographic redundancy. Lifecycle rules can transition old versions
to Glacier to cap cost.

### Local storage

`LocalStorageAdapter` writes to the directory configured by
`NP_STORAGE_DIR` (default `./public/media`). Back it up alongside the
Postgres dump on the same schedule.

```bash
# Snapshot — preserves mtimes for incremental sync next time
rsync -a --delete \
  ./public/media/ \
  /backups/media-$(date +%Y%m%d)/
```

`LocalStorageAdapter` is documented as not multi-node safe (see
`AGENTS.md`). For any deployment with more than one app instance,
move to S3 — backup story included.

## Restore

The restore order is fixed: **database, then media, then workers.**
Bringing workers up before the media files are in place causes
404s on every image request and may trigger spurious
`MEDIA_NOT_FOUND` errors that get logged as if they were data
corruption.

### 1. Database

Stop or scale the NexPress app to zero replicas first — concurrent
writes during restore corrupt the dump's transactional consistency.

```bash
# Drop and recreate the target DB (or restore into a fresh one)
psql "$ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS nexpress;"
psql "$ADMIN_DATABASE_URL" -c "CREATE DATABASE nexpress;"

# Restore (4 parallel workers; tune to your CPU)
pg_restore \
  --dbname="$DATABASE_URL" \
  --jobs=4 \
  --no-owner \
  --no-privileges \
  nexpress-20260502-030000.dump
```

If restoring across major Postgres versions, use the higher version's
`pg_restore` binary against the lower version's dump, not vice versa.

### 2. Media

Restore the file store _to match the DB you just restored_. Mismatched
backups cause silent breakage:

- Files newer than the DB restore point → orphaned files, no broken
  pages, but storage cost creeps.
- Files older than the DB restore point → admin renders with broken
  images for any media uploaded between the two timestamps.

Always restore both stores from snapshots taken within the same
backup window.

```bash
# S3 — point-in-time restore via versioned objects
# (use a tool like `s3-pit-restore` or aws s3 sync from a backup bucket)

# Local — atomic rsync
rsync -a --delete /backups/media-20260502/ ./public/media/
```

### 3. Workers and app

Bring app replicas back up. The worker (`startWorker()`, invoked
from `scripts/worker.ts` in your site or `apps/web` in the
monorepo) boots, registers in `np_worker_heartbeats`, and starts
pulling from the pg-boss tables that were restored along with the
DB.

```bash
# Docker
docker compose up -d web

# Kubernetes
kubectl scale deployment/nexpress-web --replicas=2

# Fly.io
fly scale count 2
```

### 4. Verify

Run the smoke test before you tell anyone the restore is done.

| Check                                       | Pass criteria                                    |
| ------------------------------------------- | ------------------------------------------------ |
| `GET /` — public home page                  | 200, content matches expected version            |
| `GET /admin/login` — admin login            | 200                                              |
| Sign in as an existing admin                | Lands on `/admin`, no token mismatch             |
| `/admin/collections/posts` — list view      | Existing posts shown                             |
| Open the most recently published post       | Body content + media render without 404s         |
| `/admin/jobs` — job admin                   | Worker shows online in heartbeat widget          |
| Trigger a small job (e.g. media re-process) | Completes, appears in archive                    |
| `/api/health` (if configured)               | 200                                              |
| Server logs                                 | No `MEDIA_NOT_FOUND` or `verifyTokenFull` errors |

If any check fails, **do not run `pnpm db:migrate`** as a fix. The
schema is already at the correct version (see [Dump](#dump) above).
Investigate the specific failure; running migrations on a partially-
restored DB makes things worse.

## Planned maintenance

Use this pattern for upgrades that need a known-good rollback point:

1. Take a fresh dump immediately before the maintenance window.
2. Scale app to zero (or to one read-only replica).
3. Apply the change (migration, plugin install, theme switch).
4. Bring the app back up.
5. If verification fails, restore from step 1's dump per the
   [Restore](#restore) section.
6. Keep the dump for 30 days, then prune.

For rolling upgrades that don't require a maintenance window (most
NexPress upgrades fall here), a backup is still cheap insurance —
take the dump anyway.

## Disaster-recovery drill

Once a quarter, restore to a throwaway database and tick off the
verification checklist. The drill catches:

- Backup corruption (dump unreadable, missing tables).
- Storage drift (S3 lifecycle rules deleted versions you needed).
- Documentation drift (this guide doesn't match the current shape).
- Tooling drift (`pg_restore` version no longer compatible with the
  dump format).

A drill that finds nothing is the drill working as intended; budget
the time anyway.

Before touching an isolated database, generate the read-only restore plan:

```bash
nexpress ops backup verify latest --json
nexpress ops backup restore-plan latest --json
```

`restore-plan` reads the backup manifest, checks that recorded database and
media artifacts are still present, and prints the ordered restore / verify /
record steps with approval flags. It never drops databases, runs `pg_restore`,
or mutates media storage; use it as the operator checklist for the isolated
drill.

The backup CLI records and verifies operator-provided artifacts; it does not
create a database dump or media snapshot itself. Brief reports include the same
action notes as JSON plans so placeholder-looking commands such as
`nexpress ops backup create --database artifacts/db.dump --verified --json`
are read as "record this artifact after you have captured it."

## Automation snippets

### Cron (host)

```bash
# /etc/cron.daily/nexpress-backup
0 3 * * * postgres pg_dump --dbname="$DATABASE_URL" \
  --format=custom --no-owner --no-privileges \
  --file=/var/backups/nexpress/$(date +\%Y\%m\%d).dump \
  && find /var/backups/nexpress -mtime +30 -delete
```

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: nexpress-backup }
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: pg-dump
              image: postgres:16-alpine
              env:
                - name: DATABASE_URL
                  valueFrom: { secretKeyRef: { name: nexpress, key: database-url } }
              command: ["sh", "-c"]
              args:
                - |
                  pg_dump --dbname="$DATABASE_URL" --format=custom \
                    --no-owner --no-privileges \
                    --file=/backups/$(date +%Y%m%d).dump
              volumeMounts:
                - { name: backups, mountPath: /backups }
          volumes:
            - name: backups
              persistentVolumeClaim: { claimName: nexpress-backups }
```

### S3 dump shipping

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges | \
  aws s3 cp - "s3://my-nexpress-backups/$(date +%Y%m%d).dump"
```

S3 lifecycle rule on the backup bucket: transition to Glacier after
30 days, expire after 1 year. Tune to your retention policy.

## Related

- [`operations.md`](operations.md) — incident-time runbook
- [`deployment.md`](deployment.md) — first-time deploy
- [`jobs.md`](jobs.md) — job handler idempotency requirements
- [`multi-site.md`](multi-site.md) — multi-tenant data model
