# Isolated community operations pilot

This pilot connects an ordinary `create-nexpress` project to the existing
Moderator and Incident Studio owners. The community brief has three public
boards for announcements, questions, and general discussion. The announcements
board is staff-write and the other two accept member posts. Moderator evidence
comes from five synthetic comments by three authenticated members and one actual
report filed by a fourth member. The existing repeated-link threshold applies.

## Prepare a disposable project

Use a fresh `create-nexpress@0.1.42` project and a dedicated PostgreSQL database
named `developer_community` on a nondefault `127.0.0.1` port. Set `SITE_URL` to a
different loopback port for the Next production server. Provide a synthetic
`NP_SECRET` and `NP_COMMUNITY_PILOT_PASSWORD`, set `NP_EMAIL_ADAPTER=noop`,
`NP_STORAGE_ADAPTER=local`, and set `NP_STORAGE_DIR` to a temporary local
storage directory. The preparation below runs from the
generated project. `pilot_sources` points to this directory and `pilot_receipts`
points to a new private directory outside the project.

```sh
pnpm dlx create-nexpress@0.1.42 developer-community
cd developer-community
pnpm install
pnpm db:generate
pnpm db:migrate
NP_ADMIN_EMAIL=requester@example.test NP_ADMIN_NAME='Pilot Requester' \
  NP_ADMIN_PASSWORD="$NP_COMMUNITY_PILOT_PASSWORD" NP_SETUP_CREATE_ADMIN=true \
  NP_ADMIN_THEME=community NP_SITE_NAME='개발자 커뮤니티' \
  NP_SETUP_RUN_MIGRATIONS=false NP_SETUP_SAMPLE_CONTENT=false \
  pnpm run setup -- --non-interactive

mkdir -p scripts/community-operations
cp "$pilot_sources/host.ts" src/lib/community-operations-host.ts
cp "$pilot_sources/moderation-schedule.ts" src/lib/community-operations-moderation-schedule.ts
cp "$pilot_sources/bootstrap.ts" src/lib/bootstrap.ts
cp "$pilot_sources/prepare.ts" "$pilot_sources/journey.ts" scripts/community-operations/
```

Export the pilot activation and synthetic requester ID. Keep the same
environment for the command and server processes.

```sh
NP_COMMUNITY_PILOT_STAFF_ID=$(psql "$DATABASE_URL" -XAt \
  -c "SELECT id FROM np_users WHERE email = 'requester@example.test'")
test -n "$NP_COMMUNITY_PILOT_STAFF_ID"
export NP_COMMUNITY_OPERATIONS_PILOT=1 NP_COMMUNITY_PILOT_STAFF_ID
```

The host installs the observed-comment
and report sources, Incident Studio, local Admin notifications, and the
approval-bound content response path. Both staff decision sessions come from
the pilot's password endpoint. Approval and response execution verify live session
identity and original login time. The observer and collector admit no model work.

```sh
pnpm exec tsx scripts/community-operations/prepare.ts "$pilot_receipts/site.json"
pnpm typecheck
pnpm build
```

From the generated project, expose the standalone server and its assets on the
port in `SITE_URL`. Confirm HTTP 200 from `/api/health/ready` before recording
the journey.

```sh
ln -s "$PWD/.next/static" .next/standalone/.next/static
ln -s "$PWD/public" .next/standalone/public
HOSTNAME=127.0.0.1 PORT="${SITE_URL##*:}" node .next/standalone/server.js
```

## Optional scheduled collection

Set these variables in the isolated web and Worker environments before starting
the pilot.

```sh
export NP_ENABLE_JOBS=1 NP_COMMUNITY_PILOT_MODERATION_SITE=default
```

After the web is ready, start the existing Worker command in a separate
process. When using a framework build with the [Worker web connection
check](../../docs/jobs.md#3-producer-vs-worker), set the shared
`NP_SCHEDULER_TOKEN` and run that check first.

```sh
pnpm run worker
```

The local plugin uses the existing pg-boss plugin schedule. Every minute it
finds actual comment report events from the six most recent closed ten-minute
windows at the configured site. Closed report windows in that one-hour range
remain eligible after a Worker outage. The schedule checkpoints completed
collections in six site-scoped plugin storage slots. Each checkpoint binds the
window, configured collector identity, and exact retained comment and report
event IDs and hashes. The next tick skips an unchanged checkpoint. Late events
change the digest. Failed or unfinished collections remain eligible on the
next tick. The existing collector and Incident writer own live evidence,
current staff authority, and replay. Jobs logs identify collected and skipped
windows. The schedule produces advisory Incidents for staff review.
Quarantine and restoration use the human
approval path below. To remove the schedule, unset
`NP_COMMUNITY_PILOT_MODERATION_SITE` on both processes, restart them, and use
**Plugins → Reload all** to reconcile the saved cron entry.

## Resume from the deployed site

```sh
pnpm exec tsx scripts/community-operations/journey.ts record "$pilot_receipts"
pnpm exec tsx scripts/community-operations/journey.ts finish "$pilot_receipts"
```

`record` posts through the deployed member endpoints and writes the site,
origin, local build ID, post, report, target, and detector window to `recorded.json`.
Run it once per fresh fixture. The private lock prevents a second recording.
`finish` starts in a separate process. It checks the same deployment and exact
report and waits for the real detector window to close. With scheduled
collection, it waits for two distinct Worker job logs recording the initial
collection and a subsequent unchanged-window skip. With the manual pilot
configuration, it invokes the collector and verifies the replay directly.
Both modes check that the report appears in the Incident's evidence and the
Admin feed has one matching notification.

The two fixture staff accounts exercise the real approval, quarantine, and restore
handlers. Each action checks self-approval rejection, separate approval, and an
exact execution replay. The public comments endpoint verifies removal and
restoration, and the action journal verifies both effects. After restoration,
the requester dismisses the synthetic report in the existing community queue
and confirms public visibility again.

A completed run writes `operations-handoff.json` with the Incident path, action
and approval identifiers, verification outcomes, the scheduled Worker job IDs when present, and the
observed zero provider-call count. Once `finish` creates a plan, its requester session must
remain live through execution. If that session is lost, use a fresh isolated
fixture for a full rerun.
