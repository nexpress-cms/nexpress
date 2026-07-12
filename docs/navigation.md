# Navigation contract

NexPress stores every navigation location as one exact recursive wire tree and
resolves that tree into render-ready links only when it is read. The canonical,
client-safe contract lives at `@nexpress/core/navigation`.

## Stored and resolved items

Use `NpNavItem` for theme seed data, API payloads, backup files, and other
persisted values:

```ts
import type { NpNavItem } from "@nexpress/core/navigation";

const header: NpNavItem[] = [
  { id: "home", label: "Home", type: "link", url: "/" },
  { id: "posts", label: "Posts", type: "collection", collection: "posts" },
  {
    id: "about",
    label: "About",
    type: "page",
    pageId: "0195b99b-33f4-7f9d-a55d-5963cb5c0088",
    collectionSlug: "pages",
  },
];
```

The union is discriminated and exact:

- `link` requires `url`.
- `collection` requires `collection`.
- `page` requires `pageId` and may set `collectionSlug` (default: `pages`).
- Every item requires a stable, globally unique `id` and a non-empty `label`.
- Type-specific fields from another variant and unknown fields are rejected.

`getNavigation(location)` returns `NpResolvedNavItem[]`. Every resolved variant
has a concrete `url`: link URLs pass through, collections resolve to their
index path, and page references resolve through the current document slug. A
missing page keeps the item stable and resolves to `#`.

```ts
import { getNavigation } from "@nexpress/core";
import type { NpResolvedNavItem } from "@nexpress/core/navigation";

const items: NpResolvedNavItem[] = await getNavigation("header");
```

## Bounds and URL rules

A location supports at most two item levels (top-level items plus one child
level) and 200 total items. IDs use letters, numbers, dots, underscores,
colons, and hyphens and are unique across the complete tree. Labels are
trimmed, control-character-free strings of at most 200 characters.

Link URLs may be relative or use `http`, `https`, `mailto`, or `tel`.
Whitespace, backslashes, protocol-relative URLs, and other schemes such as
`javascript` or `data` are rejected.

Locations are lowercase kebab-case slugs of at most 63 letters, numbers, or
hyphens. They cannot begin or end with a hyphen or contain repeated hyphens.

## Validation API

Use the analyzer when an authoring surface should report every issue and the
validator or type guard when the first failure is enough:

```ts
import {
  isNpNavigationItems,
  npAnalyzeNavigationItems,
  npValidateNavigationItems,
  npValidateNavigationLocation,
} from "@nexpress/core/navigation";
```

The subpath also exports the canonical patterns and limits used by OpenAPI and
other schema adapters. Do not duplicate the grammar in a theme, plugin, or
application route.

## Enforcement boundaries

The same contract runs for theme definitions and seed content, the Admin
editor, navigation API writes and renames, backup dry-runs/import/export, and
OpenAPI. Core and cached reads validate persisted rows before resolving them,
so a malformed row fails explicitly instead of being silently dropped or
rendered differently by each consumer.
