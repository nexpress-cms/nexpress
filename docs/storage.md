# Storage

NexPress has one storage contract for runtime configuration, media writes,
health checks, operator commands, and custom adapters. The public server-side
API lives at `@nexpress/core/storage`.

## Runtime modes

`NP_STORAGE_ADAPTER` is exact and case-sensitive:

| Value    | Required configuration                               | Runtime implementation           |
| -------- | ---------------------------------------------------- | -------------------------------- |
| `local`  | Optional `NP_STORAGE_DIR`, `NP_STORAGE_URL`          | `LocalStorageAdapter`            |
| `s3`     | `NP_S3_BUCKET`, `NP_S3_REGION`; optional endpoint    | `S3StorageAdapter`               |
| `custom` | A programmatic adapter passed to `createBootstrap()` | Application-owned implementation |

When the variable is absent, local storage defaults to `./public/media` with
the public URL prefix `/media`. Unknown values, case variants, missing S3
bucket/region values, credentials in URLs, query strings, fragments, and
unknown configuration fields fail closed. `NP_S3_ENDPOINT` is for R2, MinIO,
or another S3-compatible service; leave it unset for AWS S3.

`storageFromEnv()` in `@nexpress/app/config-defaults` uses this contract, so a
normal scaffold needs no custom parsing:

```ts
storage: storageFromEnv(),
```

The non-interactive setup wizard installs only the built-in local and S3
modes. A custom adapter is code, so it must be wired in the application.

## Custom adapters

Every adapter declares a canonical lowercase `kind` and all five object
operations. An optional `shutdown()` releases sockets, clients, timers, or
other resources owned by the adapter.

```ts
import type { NpStorageAdapter } from "@nexpress/core/storage";
import { createBootstrap } from "@nexpress/next";

const storageAdapter: NpStorageAdapter = {
  kind: "cloudflare-r2",
  async upload(key, data, metadata) {
    // Persist exactly `metadata.contentLength` bytes under `key`.
  },
  async getStream(key) {
    return new ReadableStream();
  },
  async getUrl(key) {
    return `https://cdn.example.com/${key}`;
  },
  async delete(key) {},
  async exists(key) {
    return false;
  },
  async shutdown() {},
};

createBootstrap({
  config: {
    // ...
    storage: { adapter: "custom" },
  },
  generatedSchema,
  storageAdapter,
});
```

Set `NP_STORAGE_ADAPTER=custom` when `storageFromEnv()` supplies the project
config. A built-in runtime intent rejects an injected adapter, and custom mode
rejects the reserved `local` and `s3` kinds. `setStorageAdapter()` remains
available only from the experimental `@nexpress/core/bootstrap` boundary for
lower-level hosts. Normal applications inject the adapter through
`createBootstrap()`; `@nexpress/core/storage` exposes contracts and operations,
not singleton mutation.

## Object contract

Storage keys are bounded relative object keys. `/`, backslashes, empty
segments, `.` and `..` segments, whitespace, control characters, and URL
syntax are rejected before an adapter runs. Dot-prefixed names such as
`.nexpress-ops/probe.txt` remain valid because they do not traverse a parent.
The local adapter also confines the resolved filesystem path to its configured
root, rejects symbolic-link parents, and commits uploads with an atomic rename
so a failed stream does not replace the previous object with partial bytes.

Upload metadata is exact:

```ts
interface NpFileMetadata {
  readonly contentType: string;
  readonly contentLength: number;
  readonly originalFilename: string;
}
```

`originalFilename` must be a basename. For a `Buffer`, `contentLength` must
equal the actual byte length. Streams cannot be measured without consuming
them, so custom adapters must preserve the declared length when sending them
to the backing service.

Results are checked at the shared dispatch boundary:

- `upload`, `delete`, and `shutdown` resolve to `void`.
- `getStream` returns a Web `ReadableStream`.
- `getUrl` returns a bounded root-relative or HTTP(S) URL without credentials
  or a fragment.
- `exists` returns a boolean. Only a real not-found result maps to `false`;
  permission and transport failures remain errors.

Framework code uses `npUploadStorageObject()`,
`npGetStorageObjectStream()`, `npGetStorageObjectUrl()`,
`npDeleteStorageObject()`, and `npStorageObjectExists()` so built-in and custom
adapters cross the same validation boundary.

## Diagnostics and operations

Use these checks after changing storage configuration:

```bash
pnpm run doctor
pnpm --silent run ops:storage -- status --json
pnpm --silent run ops:storage -- test --json
```

Doctor validates intent without booting the application. Admin health and the
readiness route also compare the live adapter `kind` with the requested mode.
Standalone ops can inspect and test local/S3 adapters; it reports custom mode
as programmatic because only the running application owns that implementation.

Changing local to S3 does not move objects. Follow
[operations.md](./operations.md#switching-storage-adapters) and keep the local
tree for one rollback window. Local storage is suitable only for a deliberate
single-node deployment with a durable volume; use shared object storage for
multi-node or ephemeral hosts.
