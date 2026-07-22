# Site resource quotas

NexPress can put independent storage, document, and background-job ceilings on
each site in a multi-tenant deployment. Missing quota settings preserve the
single-site behavior: every resource is unlimited by default.

## Exact contract

The `np_settings` row `(site_id, "site.quotas")` stores one exact object:

```ts
interface NpSiteQuotas {
  storageBytes: number | null;
  documents: number | null;
  jobEnqueuesPerHour: number | null;
}
```

`null` means unlimited and `0` blocks new use. Values are non-negative safe
integers with documented upper bounds. Unknown or missing fields fail closed;
an existing malformed row is never replaced with defaults. Client-safe types,
limits, and validators are exported from `@nexpress/core/settings`. Server
services are exported from `@nexpress/core/sites`:

```ts
import { getSiteQuotaSnapshot, getSiteQuotas, setSiteQuotas } from "@nexpress/core/sites";
```

`getSiteQuotaSnapshot()` returns exact `limits`, measured `usage`, metrics that
are already `exceeded`, and configured metrics that are `unavailable`. Job
usage is `null` when the active queue cannot count exact history.

## What is counted

- `storageBytes` is the sum of every original `np_media.filesize` and every
  persisted generated variant byte count for the site. Soft-deleted media
  remains charged while its physical objects remain present; successful media
  cleanup deletes the tombstone and releases the bytes.
- `documents` counts the main row in every registered collection table. Child
  rows, revisions, settings, navigation, and other framework rows are not
  separate documents. Deleting a document restores one unit.
- `jobEnqueuesPerHour` counts quota-participating site job rows created during
  the rolling previous hour across live and archived pg-boss history. The
  bundled `plugin:scheduledTask` execution participates. Required content and
  media follow-up jobs stay exempt so a full tenant cannot prevent deletion,
  cleanup, or convergence work. A cron tick attempts every enabled site
  independently; one tenant's rejected admission is logged and does not prevent
  the remaining sites from receiving their execution jobs.

Application and plugin code must call `enqueueJob()` rather than an adapter's
raw `enqueue()` method. A custom core job can opt in additively:

```ts
registerJobHandler("acme:sync", handleSync, {
  parsePayload: parseSyncPayload,
  resolveSiteId: (payload) => payload.siteId,
  quota: "site",
});
```

The exact payload must expose the same canonical top-level `siteId` returned by
`resolveSiteId`. This lets the queue count persisted history without running
application code. Automatic retries of the same pg-boss row are continuations,
not new admissions. Explicit operator retries are administrative overrides;
their new rows are included in subsequent rolling usage.

## Concurrency and failure behavior

Quota-sensitive writes take one transaction-scoped Postgres advisory lock per
site. A concurrent document create, original upload, image-variant reservation,
quota update, or participating job admission therefore cannot pass on the same
stale usage observation.

Original media bytes are reserved in the database before object upload. Image
variant metadata and byte counts are reserved before generated objects are
written. Upload failure releases a reservation only after object cleanup is
confirmed; ambiguous cleanup keeps a conservative error-state reservation. A
process crash likewise leaves a durable reservation that a retry can safely
complete. Storage history that cannot be counted fails the write instead of
assuming zero. The same fail-closed rule applies when a configured job quota is
used with a queue that cannot provide `countSiteEnqueues()`.

Lowering a limit below current usage does not delete or hide existing content.
Reads continue, while new quota-sensitive work is rejected with the standard
`RATE_LIMITED` error until usage falls or the limit rises.

## Admin, API, and operations

Super-admins configure limits from **Admin → Sites → Quotas**. Site admins with
`admin.manage` can inspect their site's snapshot but cannot change limits.

- `GET /api/admin/sites/{id}/quotas` returns the exact snapshot.
- `PATCH /api/admin/sites/{id}/quotas` replaces the exact limits and requires a
  super-admin.

Both routes are in OpenAPI and the create-nexpress scaffold. `nexpress doctor`
and `nexpress ops status` emit `sites.quotas`: malformed or unmeasurable
enforcement is blocking, while a site at capacity is an operator warning. The
standalone check conservatively counts every canonical physical collection main
table and measures the bundled site-quota job class. The runtime Admin snapshot
uses registered collections and additionally includes every custom
quota-participating handler loaded in that process. A leftover collection table
therefore stays visible to operations until its migration removes the rows or
table.

Quotas are deployment-owned operational policy, not portable content. Full
site export omits `site.quotas`, full import preserves the destination row, and
an envelope that tries to supply the key is rejected.
