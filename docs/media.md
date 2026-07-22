# Media runtime contract

NexPress stores one original object per media row and, for processed images,
an exact map of generated variants in `np_media.sizes`. The same contract now
drives the Sharp processor, persisted reads, URL resolution, Admin API payloads,
OpenAPI, cleanup, and storage diagnostics.

## Public imports

Server-side media operations remain under the existing subpath:

```ts
import { getMediaById, getMediaUrl, uploadMedia } from "@nexpress/core/media";
```

The pure types and validators are available to server and client code without
pulling Sharp, PostgreSQL, or the storage adapters into a browser bundle:

```ts
import {
  isNpMediaApiItem,
  isNpMediaAttachmentWire,
  npMediaAttachmentAccept,
  npValidateMediaProcessingOptions,
  npValidateMediaVariants,
  type NpMediaRecord,
  type NpMediaVariant,
} from "@nexpress/core/media-contract";
```

`@nexpress/core/media` also re-exports the contract for server-only consumers.

## Site ownership

Every `np_media`, `np_media_folders`, and `np_media_refs` row carries one
canonical `siteId`. Uploads require a site execution context, stamp that site,
validate that an optional folder belongs to it, and write new objects below
`media/<siteId>/<mediaId>/`. Reads, list filters, URL resolution, reference
creation, member quotas, imports, exports, and deletes use the current site
automatically. Knowing another site's media UUID is therefore insufficient to
read, attach, move, process, or delete it.

Code running outside a request must wrap writes in `withCurrentSite()`.
Framework-host code can use `requireSiteId()` to project that required owner.
Reads retain the single-site `default` fallback, while writes fail when
bootstrap, worker, or script wiring omitted a site scope. Existing default-site
storage keys remain valid; the migration backfills ownership without moving
objects.

## Member attachment contract

NexPress reuses media rows for downloadable document attachments. The
client-safe `NpMediaAttachmentWire` contains only `id`, safe filename,
canonical MIME type, byte count, processing status, and the fixed download
URL. It never exposes a storage key, direct object URL, hash, or uploader
identity. `npMediaAttachmentAccept` provides the matching browser file-picker
value; the server remains authoritative.

`POST /api/members/media/attachments` accepts one multipart `file` from an
active member. It applies the normal member upload quota, validates a safe
basename, a maximum of 25 MiB, the extension/MIME pair, and file magic or
container signature before writing `np_media`. Images may return
`status: "processing"`; other accepted attachments are ready immediately.

`GET|HEAD /api/media/attachments/:id` streams the original only to its member
uploader or when a public published document currently references the media
through an `attachments.file` field. It always forces download, sends
`nosniff`, a sandbox CSP, and `private, no-store`. The owner-only
`DELETE /api/members/media/attachments/:id` deletes only an unreferenced file.
Reference creation and soft-delete lock the same media row, so a concurrent
post save cannot succeed with an attachment that the delete request already
made unavailable.
These endpoints intentionally differ from ordinary resolved image URLs: an
attachment must never become inline active content merely because its original
object exists in storage.

## Persisted variant shape

Each key in `np_media.sizes` is a lowercase safe path segment. `original` is
reserved for the uploaded source and cannot be used as a generated variant
name. One variant is exactly:

```ts
interface NpMediaVariant {
  filename: string;
  mimeType: string;
  filesize: number;
  width: number;
  height: number;
  storageKey: string;
}
```

No URL is stored. URLs depend on the active local/S3 adapter and deployment
base, so `getMediaUrl(id, { variant })` always resolves the variant's actual
`storageKey` through that adapter. This also means AVIF, JPEG, PNG, WebP, and
custom variant names work without guessing a `.webp` filename.

Rows written by older builds may contain a cached `sizes.<name>.url`. Remove
that member before optional variant reprocessing; unknown variant fields fail
closed by design.

The contract rejects unknown fields, unsafe names or storage keys, non-image
variant MIME types, non-integer dimensions or byte counts, more than 64
variants, and dimensions beyond the safety bounds.

## Media records

`getMediaById()` now returns `NpMediaRecord | null` instead of an untyped
record. Every selected database row is validated before it leaves core. That
includes:

- UUID identifiers and at-most-one staff/member uploader;
- one canonical site owner;
- canonical SHA-256 hashes and relative storage keys;
- paired width/height values;
- `NpRichTextContent` captions;
- focal-point `{ x, y }` coordinates in the closed `0..1` range;
- exact variant maps and valid dates.

Malformed persisted rows fail closed with their contract path rather than
being partially interpreted by rendering, cleanup, or API code.

## Processing lifecycle

Image uploads start as `processing`, enqueue the exact
`{ siteId: <canonical-site-id>, mediaId: <uuid> }` job payload, and become
`ready` only after validated variant metadata is written. The job registry
restores that site scope for the entire processor dispatch. The built-in worker
now runs the core image processor when a host has not supplied an override.
Non-image uploads are stored once as `ready` and do not enqueue a Sharp job.

Processing options are exact and validated before Sharp or storage work:

```ts
{
  sizes: [{ name: "og", width: 1200, height: 630, crop: "center" }],
  format: "avif", // avif | jpeg | png | webp
  quality: 75,    // integer 1..100
}
```

Size names must be unique, safe, and different from `original`; dimensions are
bounded positive integers, and `crop` requires an explicit height.

Plugins use the same URL contract:

```ts
const cardUrl = await ctx.media.getUrl(mediaId, { variant: "medium" });
const exactOgUrl = await ctx.media.getUrl(mediaId, {
  variant: "og",
  fallbackToOriginal: false,
});
```

The result is `string | null`. NexPress does not promise on-demand width/height
transforms; plugins select a pre-generated canonical variant instead.

## Admin API

`GET /api/media` and `GET /api/media/:id` serialize dates explicitly and add:

```ts
urls: {
  original: string;
  thumbnail: string | null;
}
```

List items also carry the resolved staff/member uploader summary. The Admin
library validates every item with `isNpMediaApiItem`, reads the canonical
`filesize`, and renders the actual resolved thumbnail URL. Search uses the
documented `q` query parameter. Media and folder endpoints use the selected
Admin site; create, rename, delete, and upload cannot cross that boundary.
Deletion also refuses media still used by a document or a staff/member avatar.

## Operations

`nexpress ops storage ...` validates every non-null variant map before adding
its objects to the storage index. Malformed maps produce the blocking
`storage.media_contract` check instead of silently harvesting whichever keys
happen to look usable. Original objects remain indexed so operators can still
inspect the affected rows and storage state.

`nexpress doctor` adds `media.contract`. It validates the exact persisted media
record, active site owners, folder parent/media ownership, and reference/media
ownership. Cross-site links and active media whose site was removed are
blocking diagnostics. Deleted tombstones may retain a removed site id until
the daily global cleanup job has reclaimed their storage objects after 30 days.
If any storage delete fails, the row remains a tombstone so a later run can
retry instead of losing the only durable pointer to the object.
