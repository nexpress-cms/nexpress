# packages/admin — AGENTS.md

Gateway execution Activity reuses the existing safe run/action projections; never show raw canonical inputs or invented Runtime/provider facts. Active run and ChangeSet detail share bounded backoff polling, stop on terminal/access loss and cancel timers on navigation. All 62 production browser tests passed, including hostile approval HTML/Markdown, typed challenge enforcement and stable unknown-outcome keys across read errors. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow.

Rollback controls use existing review.rollbackDetail/rollbackActions and exact same-service contracts. Reuse current declared editable-field projection for restoration diffs; hide undeclared/hidden/read-only snapshot metadata. Request a fresh approval for the exact rollback plan/version/hash; execute only its signed approval. Non-executing cancellation uses the existing ChangeSet cancel route with the rollback-plan discriminator. Keep unknown-outcome keys stable and clear evidence on conflict/access loss. No optimistic success or new public verify route. The preceding rollback slice passed all 60 production browser tests; see the R4 rollback flow results.

Admin UI package: shadcn-style primitives (Radix + Tailwind v4) + CMS views. Built with tsup, not Next.

**Generated:** 2026-04-22 | **Commit:** 2e07135

## STRUCTURE

```
src/
├── ui/                  # 19 primitives: Button, Input, Dialog, Select, Tabs, Tooltip, etc.
│   └── utils.ts         # cn() = clsx + tailwind-merge
├── collections/         # Collection CRUD views
│   ├── collection-list-view.tsx    # List + pagination + search
│   ├── collection-edit-view.tsx    # Create/edit form (react-hook-form + Zod)
│   ├── field-renderer.tsx          # Maps NpFieldConfig → UI controls (490 lines)
│   └── fields/                     # Specialized field editors (array, relationship, media-picker)
├── media/               # Media library grid + upload zone
├── settings/            # Theme editor, navigation editor, user management
├── dashboard/           # Dashboard view
├── layout/              # AdminShell (sidebar + topbar)
├── lib/                 # api-client.ts (npFetch helper for API calls)
├── client.ts            # Package client entry — re-exports all client views + UI primitives
├── index.ts             # Package root entry — types + server-safe exports
└── next-shim.d.ts       # Type shims for next/link and next/navigation (tsup build needs these)
```

## WHERE TO LOOK

| Task                            | File(s)                                                              | Notes                                                                      |
| ------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Add a field type to admin forms | `collections/field-renderer.tsx` + new file in `collections/fields/` | Update the switch in `renderNamedField()`                                  |
| Add a UI primitive              | `ui/`                                                                | Follow shadcn pattern: Radix + cva + cn(). Do NOT mark with `"use client"` |
| Change admin layout/nav         | `layout/admin-shell.tsx`                                             | Client component; receives user + collections props from server layout     |
| Change media library UI         | `media/media-library.tsx`                                            | Client component; calls `/api/media` endpoints                             |
| Add an admin settings page      | `settings/`                                                          | Follow existing view pattern; add to AdminShell nav                        |
| Change API call patterns        | `lib/api-client.ts`                                                  | `npFetch` wraps fetch with auth headers + CSRF                             |

## CLIENT/SERVER BOUNDARY

- **UI primitives** (`ui/*.tsx`) are NOT marked `"use client"` — they are neutral components. Consuming pages decide the boundary.
- **Views** (collection-_, media-_, settings-_, dashboard-_, layout/\*) ARE marked `"use client"` — they use hooks, state, and browser APIs.
- **Heavy editors** are lazy-loaded in `field-renderer.tsx`:
  - `React.lazy(() => import("@nexpress/editor/client"))` for rich-text
  - `React.lazy(() => import("../blocks/block-page-editor.js"))` for block editor (lives in this package; see `src/blocks/`)
  - This prevents bundling Lexical + dnd-kit unless the field type is actually used.
- The `client.ts` entry is built by tsup with `"use client"` banner. Consumers import `@nexpress/admin/client`.

## CONVENTIONS

- **`@nexpress/core` is types-only here** — admin imports `type { NpCollectionConfig, NpFieldConfig, ... }` from core. Pure browser-safe runtime validators may be imported only from explicit `@nexpress/core/*-contract` subpaths. All data access goes through HTTP API calls to `/api/*`.
- **`next-shim.d.ts`** exists because this package uses `next/link` and `next/navigation` but is built outside a Next app. Do not remove it — tsc will fail.
- **`.js` extensions** in all relative imports (NodeNext resolution).
- **`as never` casts** exist in `field-renderer.tsx` and `fields/array-field-editor.tsx` for complex generic intersections. Minimize but don't add more.

## ANTI-PATTERNS

- **Never import server runtime exports from `@nexpress/core`** — only type imports from the server root/domain subpaths and pure runtime validators from explicit `*-contract` subpaths. This package runs in the browser.
- **Never mark UI primitives with `"use client"`** — keep them boundary-neutral.
- **Never import `@nexpress/editor/client` statically** — always use `React.lazy` dynamic imports to avoid client bundle bloat. The block page editor (`src/blocks/`) follows the same rule via `React.lazy(() => import("../blocks/block-page-editor.js"))` in field-renderer.
