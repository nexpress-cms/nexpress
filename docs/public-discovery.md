# Public discovery API

NexPress exposes three unauthenticated discovery endpoints for agents, code
generators, and operator tooling:

- `GET /api/meta/blocks`
- `GET /api/meta/collections`
- `GET /api/meta/plugins`

They share an exact `{ items: [...] }` envelope. Unknown fields, duplicate item
identities, accessors, functions, non-finite numbers, circular values, and
values beyond the published bounds fail closed before a response is emitted.
The OpenAPI 3.1 document references the same closed item and envelope schemas.

Untrusted payloads can be checked from the client-safe entry point:

```ts
import {
  npRequireBlockDiscoveryResponse,
  npRequireCollectionDiscoveryResponse,
  npRequirePluginDiscoveryResponse,
} from "@nexpress/core/discovery";

const collections = npRequireCollectionDiscoveryResponse(
  await fetch("/api/meta/collections").then((response) => response.json()),
);
```

The `npAnalyze*` variants return structured issues instead of throwing.

## Blocks

The block endpoint boots plugins before reading the shared registry. Its list is
therefore the process-wide last-write-wins registry used by rendering and
Admin, not the built-in seed list. Enabled plugin contributions and every
configured theme contribution remain in that registry; `source` lets
site-aware consumers apply the same active-theme filter as rendering. Each item
includes:

- identity and presentation metadata (`type`, `label`, `icon`, `category`);
- concrete ownership in `source` (`built-in`, `plugin:<id>`, or `theme:<id>`);
- exact JSON-safe `defaultProps` and recursive `propsSchema`;
- container, summary, keyword, and allowed-child metadata.

The server-only `render` function never crosses the boundary.

## Collections

The collection endpoint reads the resolved collection registry. Each item
contains labels, ownership, i18n/timestamp/draft settings, slug behavior, and a
recursive field inventory. Collection and field `source` values identify
project-owned definitions or their concrete `theme:<id>` contributor. Date
defaults are canonical UTC ISO strings and every other default must already be
JSON-safe.

Access callbacks, hooks, validators, Admin components, and SEO functions are
server-only and are intentionally absent.

## Plugins

The plugin endpoint reads the host registration after setup has completed. It
combines the public manifest catalog with actual runtime inventory:

- public manifest identity, compatibility, capabilities, requirements,
  `provides`, agent metadata, tokens, and style slots;
- registered hooks, API routes, page routes, scheduled tasks, and typed actions;
- `apiVersion: null` plus `legacy: true` for the legacy `init()` shape.

Author email, persisted/current plugin config, top-level Zod config schemas,
handlers, components, teardown/setup callbacks, and other executable values are
never exposed. `agent.configSchema` is included only when the manifest explicitly
declares JSON-safe catalog metadata for agents.

Load-time validation removes a plugin whose public metadata cannot satisfy the
wire contract. Static and runtime `nexpress ops plugins doctor --json` runs also
report `plugins.discovery_contract`, so the failure is diagnosable without
waiting for an HTTP request.

## Bounds and ordering

Responses are sorted by `type`, `slug`, or plugin `id`. Runtime sub-inventories
are sorted by their stable keys. The shared contract caps top-level items,
recursive fields, JSON depth, nodes, arrays, object keys, key lengths, and string
lengths; inspect `npDiscoveryContractLimits` when generating metadata near a
limit.
