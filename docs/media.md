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
  npValidateMediaProcessingOptions,
  npValidateMediaVariants,
  type NpMediaRecord,
  type NpMediaVariant,
} from "@nexpress/core/media-contract";
```

`@nexpress/core/media` also re-exports the contract for server-only consumers.

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
that member or regenerate the variants before upgrading; unknown variant
fields fail closed by design.

The contract rejects unknown fields, unsafe names or storage keys, non-image
variant MIME types, non-integer dimensions or byte counts, more than 64
variants, and dimensions beyond the safety bounds.

## Media records

`getMediaById()` now returns `NpMediaRecord | null` instead of an untyped
record. Every selected database row is validated before it leaves core. That
includes:

- UUID identifiers and at-most-one staff/member uploader;
- canonical SHA-256 hashes and relative storage keys;
- paired width/height values;
- `NpRichTextContent` captions;
- focal-point `{ x, y }` coordinates in the closed `0..1` range;
- exact variant maps and valid dates.

Malformed persisted rows fail closed with their contract path rather than
being partially interpreted by rendering, cleanup, or API code.

## Processing lifecycle

Image uploads start as `processing`, enqueue the exact
`{ mediaId: <uuid> }` job payload, and become `ready` only after validated
variant metadata is written. The built-in worker now runs the core image
processor when a host has not supplied an override. Non-image uploads are
stored once as `ready` and do not enqueue a Sharp job.

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
documented `q` query parameter.

## Operations

`nexpress ops storage ...` validates every non-null variant map before adding
its objects to the storage index. Malformed maps produce the blocking
`storage.media_contract` check instead of silently harvesting whichever keys
happen to look usable. Original objects remain indexed so operators can still
inspect the affected rows and storage state.
