# Content transfer

`GET /api/export` and `POST /api/import` move portable site configuration and
collection content between NexPress instances. They use one exact, bounded v3
wire contract from `@nexpress/core/content-transfer`; the runtime routes and
OpenAPI reference the same types, validators, inventory rules, and limits.

This is a content portability format, not a physical database backup. Use the
[backup and restore runbook](./backup-restore.md) for disaster recovery or an
exact database clone.

## Access and request boundary

Both routes require a staff session with `admin.manage`. Import is a write and
therefore also requires the normal CSRF cookie/header pair.

- Export accepts only `collections=<comma-separated-slugs>`.
- Import accepts only `collections=<comma-separated-slugs>` and
  `dryRun=true|false`.
- Query keys cannot repeat. Values are not trimmed or coerced.
- Import requires `Content-Type: application/json` and reads at most 32 MiB.
- Unknown fields, unsupported versions, non-JSON values, unsafe object keys,
  malformed Unicode, duplicate inventories, and limit violations return a
  validation error before database mutation.

Fetch `GET /api/openapi.json` for the active collection-specific envelope.
The public pure contract is also available without app imports:

```ts
import {
  NP_CONTENT_TRANSFER_VERSION,
  npRequireContentTransferEnvelope,
  type NpContentTransferEnvelope,
} from "@nexpress/core/content-transfer";
```

## Full and partial envelopes

Every envelope includes these exact fields:

```json
{
  "version": "3",
  "exportedAt": "2026-07-17T00:00:00.000Z",
  "siteUrl": "https://example.com",
  "partial": true,
  "collectionsExported": ["pages", "posts"],
  "collections": { "pages": [], "posts": [] },
  "media": []
}
```

`collectionsExported` is sorted and unique and must exactly equal the sorted
`collections` keys. Documents are exact collection wire documents, including
their canonical UUID, status, visibility, and wire timestamps.

A full envelope has `partial: false` and additionally requires `site`, `theme`,
`settings`, `navigation`, and `plugins`. Its `siteUrl` must equal `site.url`.
A partial envelope has `partial: true` and forbids those full-site sections.
Passing `collections=pages,posts` to export produces a partial envelope.

Passing a collection filter while importing a full envelope is an explicit
content-only projection: only the selected collections and their media
references are considered, and the full-site sections are ignored with a
warning. Every requested collection must be registered and present in the
envelope.

All collection keys in an imported envelope must be registered on the target;
unknown collections fail preflight instead of being silently skipped.

## Import semantics

Import performs complete preflight before opening the write transaction:

1. Validate the envelope, active collection definitions, exact document wire
   shapes, authoring schemas, and registered block definitions.
2. Resolve schema-owned media references.
3. Determine which document IDs already exist on the target site.
4. Validate registered-collection and framework `users`/`media` relationship
   targets, then order new collection targets before documents that reference
   them.
5. Validate active themes and installed/loaded plugin configuration schemas.

All database mutations for the request then use one transaction. A failure
rolls back document, site, theme, setting, navigation, and plugin-state writes.
Normal collection hooks still run, and post-commit work drains only after the
outer transaction commits.

Document identity is preserved. A missing UUID is created with its source ID;
a UUID already present on the target site is updated. Repeating the same import
therefore reports `documentsUpdated`, not another created row. Relationship IDs
are never globally rewritten. New relationship graphs are topologically
ordered; a cycle made entirely of new documents fails before mutation because
no target can satisfy the other document's foreign key first. References to a
registered collection must either appear in the transfer or already exist on
the target site. Framework `users` and direct `media` relationship IDs must
already exist on the target instance. They are never inferred, copied, or
matched to another identity.

The collection save pipeline owns target provenance. `siteId`, `createdAt`,
`updatedAt`, `createdBy`, `updatedBy`, and source `memberAuthorId` from the wire
document are not written back as source audit history or target membership.
Status, visibility, collection fields, and document UUID are preserved through
the normal validated save path.

For a full import:

- site general settings are replaced with the transferred `site` values;
- `theme: null` clears the token overlay, otherwise it replaces it;
- portable framework settings become the target's exact portable set;
- navigation locations become the transferred exact set;
- listed plugins that are installed and loaded receive the validated config
  and enabled state. Missing plugin code is warned and skipped.

Worker pause state and other operational/global state are not portable.
The target's canonical site id and hostname routing also remain target-owned.

## Media manifest

The `media` array is metadata, not binary data. Export walks the active
collection definitions and includes only media UUIDs referenced by:

- `upload` fields, including nested group/array/row/collapsible fields;
- NexPress rich-text `image` and `upload` nodes.

Ordinary text, relationship IDs, JSON fields, and block props are deliberately
not searched or rewritten. Block image/media controls currently store URLs,
not media UUID ownership.

Import matches each referenced item by SHA-256 hash, then by the exact filename
plus MIME type as a warned fallback. An unmatched item maps only its
schema-owned references to `null`; required collection schemas can consequently
reject the transfer during preflight. A normal unfiltered transfer requires the
manifest to be the exact set of referenced items. Missing or soft-deleted
source media rows make export fail closed.

If multiple active target rows match the same hash (or the same fallback pair),
the import fails as ambiguous unless one row already preserves the source media
UUID. It never chooses an arbitrary row based on database order.

Upload/copy media objects into target storage and create their media records
before import when content depends on them.

## Limits and report

The v3 contract currently caps:

| Item                               |  Limit |
| ---------------------------------- | -----: |
| Serialized envelope / request body | 32 MiB |
| Collections                        |    128 |
| Documents per collection           | 10,000 |
| Documents total                    | 25,000 |
| Media items                        | 25,000 |
| Plugin states                      |  1,000 |
| Navigation locations               |    256 |
| Report warnings                    |  2,000 |

Export never silently paginates or truncates past those bounds. Split a large
transfer with the collection filter.

Import returns an exact report:

```json
{
  "imported": {
    "site": 1,
    "theme": 1,
    "settings": 3,
    "navigation": 2,
    "documentsCreated": 12,
    "documentsUpdated": 4,
    "mediaMatched": 6,
    "pluginsUpdated": 2
  },
  "warnings": [],
  "dryRun": false,
  "partial": false
}
```

`dryRun=true` executes the same parsing, definition, media, identity,
relationship, theme, and plugin preflight and returns the counts that a real
run would use, without opening the mutation transaction.

## What is not transferred

The envelope does not contain media binaries, plugin/theme source packages,
database schema or migrations, credentials, auth/session rows, job state,
operational pause state, logs, or exact source audit timestamps. Install code,
run schema generation/migrations, and provision media/storage before import.
