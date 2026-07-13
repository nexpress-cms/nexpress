# Revisions and autosave

NexPress stores versioned authoring snapshots in `np_revisions`. A revision is
edit history, not a backup: deleting a document removes its revisions in the
same transaction. Use the database and media backup procedures in
[backup-restore.md](backup-restore.md) for disaster recovery.

## Enabling versions

```ts
defineCollection({
  slug: "posts",
  // ...
  versions: {
    drafts: { autosave: true, autosaveInterval: 5_000 },
    max: 50,
  },
});
```

Declaring `versions` enables revision history. `drafts: true` also enables draft
authoring without background autosave; the object form with `autosave: true`
exposes the autosave endpoint and enables the Admin recovery loop. `max` applies
to draft, published, and autosave rows together. Pruning removes the oldest rows
but version numbers remain monotonic; they are never reused.

## Snapshot contract

Every write, read, restore, Admin response, and doctor check uses the pure
client-safe contract exported from `@nexpress/core/revisions`.

- A snapshot is a bounded plain JSON object. `Date` values produced by server
  hooks are stored as canonical UTC ISO strings. Non-finite numbers, class
  instances, cycles, `undefined` array entries, excessive depth/size, and
  unknown collection fields fail closed.
- Present fields follow the collection definition, including recursive
  group/array fields, the NexPress rich-text envelope, and the recursive block
  wire contract. The app boundary additionally checks block types and props
  against the live block registry before autosave, detail delivery, or restore.
- Autosave is intentionally partial: required fields may be missing or empty
  while an editor is typing. This relaxes presence only; malformed values and
  undeclared fields are still rejected before persistence.
- Persisted rows use exact statuses (`draft`, `published`, `autosave`), positive
  monotonic versions, sorted unique `changedFields`, canonical timestamps, and
  exact row shapes. API responses serialize timestamps explicitly rather than
  relying on framework JSON coercion.

The public helpers `npAnalyzeRevisionSnapshot`, `npAnalyzeRevisionWire`,
`npAnalyzeRevisionWireList`, and `npAnalyzeAutosaveRevisionWireResult` can be
used by clients that need to validate untrusted API responses.

## HTTP API

Versioned collections expose:

- `GET /api/collections/{slug}/{id}/revisions?limit=20&offset=0`
- `GET /api/collections/{slug}/{id}/revisions/{revisionId}`
- `POST /api/collections/{slug}/{id}/revisions/{revisionId}/restore`

Collections with explicit autosave also expose:

- `POST /api/collections/{slug}/{id}/autosave`

The autosave request is a partial collection-derived snapshot. Its exact
response is:

```json
{
  "saved": true,
  "revisionId": "9b3dd862-3727-41b0-a2fa-f87362af6da0",
  "version": 4
}
```

`saved: false` means the latest autosave already contains the same canonical
snapshot; `revisionId` and `version` identify that existing row. Concurrent
autosaves lock the document row, so deduplication and version allocation are
atomic.

List/detail responses are route-scoped and therefore omit redundant
`collection` and `documentId` fields. The live OpenAPI document publishes the
same closed, collection-derived snapshot and response schemas.

## Restore and operations

Restoring a revision writes its snapshot through the normal collection pipeline
and creates a new head revision. It never rewinds or mutates history in place.
Malformed persisted snapshots fail before dispatch or restore.

`pnpm run doctor` includes `revisions.contract`. It checks exact persisted row
and snapshot structure, missing collection tables, and orphan revisions. Repair
or remove reported rows before relying on restore. The generic CLI check does
not load project collection definitions; runtime reads add the collection-aware
field and block validation described above.
