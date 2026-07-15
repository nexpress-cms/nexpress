# Code-owned custom routes

Custom routes are public Next.js pages written in application code that should
also be discoverable by NexPress operators. The registry does not create or
dispatch a route. It gives **Settings → Routes** and the navigation editor an
exact inventory of paths the application already owns.

## Declare the complete catalog

Generated projects own `src/lib/custom-routes.ts`:

```ts
import { npDefaultCustomRoutes } from "@nexpress/app/lib/custom-routes";
import { npDefineCustomRoutes } from "@nexpress/core/routes";

export const npCustomRoutes = npDefineCustomRoutes([
  ...npDefaultCustomRoutes,
  {
    path: "/about",
    label: "About",
    description: "Company and team",
    icon: "building",
    group: "company",
  },
  {
    path: "/events/[slug]",
    label: "Event detail",
    group: "company",
  },
]);
```

`npDefineCustomRoutes()` validates and freezes the complete array during module
evaluation. The shared app bootstrap registers that array as source
`app:site`. When HMR produces a new array, registration atomically replaces the
previous source snapshot, so deleted definitions do not remain in memory.

Keep this module pure. It may import route constants and the client-safe
`@nexpress/core/routes` contract, but it should not import the database,
bootstrap, `nexpress.config.ts`, or request state. `pnpm run doctor` loads this
module without booting the app so a malformed route catalog remains
diagnosable even when normal startup cannot proceed.

## Definition contract

Each definition is an exact object. Unknown or explicitly `undefined` fields
are rejected.

| Field         | Required | Contract                                                  |
| ------------- | -------- | --------------------------------------------------------- |
| `path`        | yes      | canonical path, at most 256 characters                    |
| `label`       | yes      | trimmed text, 1–160 characters                            |
| `description` | no       | trimmed single-line text, 1–500 characters                |
| `icon`        | no       | lowercase kebab-case Lucide name, at most 63 characters   |
| `group`       | no       | lowercase kebab-case Admin grouping key, at most 63 chars |

One catalog may contain at most 200 routes and may not repeat a path.

### Path grammar

`/` is valid. Other paths use non-empty segments with no trailing slash,
double slash, query, hash, backslash, whitespace, or `.` / `..` segment.
Literal segments contain Unicode letters/numbers plus `.`, `_`, `~`, and `-`.

Next-style dynamic segments are supported as whole segments:

- `[name]`
- `[...name]` — final segment only
- `[[...name]]` — final segment only

Parameter names use JavaScript identifier-style ASCII names and cannot repeat
inside one path. A route containing any parameter is emitted with
`kind: "dynamic"`; other paths are emitted with `kind: "static"`.

Dynamic routes remain visible in **Settings → Routes**, but they have no Open
link and are excluded from navigation autocomplete because the framework
cannot derive a literal href without parameter values.

## Runtime and wire contract

`GET /api/admin/custom-routes` is gated by `admin.manage` and returns:

```ts
interface NpCustomRoutesResponse {
  routes: Array<{
    path: string;
    label: string;
    description?: string;
    icon?: string;
    group?: string;
    kind: "static" | "dynamic";
    source: string;
  }>;
}
```

The API constructs this response with `npCreateCustomRoutesResponse()`. Admin
consumers parse it with `npRequireCustomRoutesResponse()`; malformed or partial
payloads fail instead of being silently filtered into a misleading catalog.

Framework hosts and integration packages may manage additional catalogs with
`npRegisterCustomRoutes(source, definitions)` and
`npUnregisterCustomRoutes(source)`. Sources are bounded colon-separated ids,
for example `app:site` or `integration:docs`. Registration validates the whole
candidate before mutation. A path already owned by another source is an error,
and a failed replacement preserves the previous registry state.

The registry is process-scoped and code-owned. Every site in a multi-site
process sees the same inventory because all sites run the same application
bundle.

## Diagnostics

```bash
pnpm run doctor
pnpm --silent run doctor -- --json
```

The stable `routes.contract` check loads `src/lib/custom-routes.ts`, validates
the exact definition array, and reports total/static/dynamic counts. Registry
registration repeats validation at bootstrap, so code that bypasses
`npDefineCustomRoutes()` still fails before Admin or navigation reads it.
