# packages/admin — AGENTS.md

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
│   ├── field-renderer.tsx          # Maps NxFieldConfig → UI controls (490 lines)
│   └── fields/                     # Specialized field editors (array, relationship, media-picker)
├── media/               # Media library grid + upload zone
├── settings/            # Theme editor, navigation editor, user management
├── dashboard/           # Dashboard view
├── layout/              # AdminShell (sidebar + topbar)
├── lib/                 # api-client.ts (nxFetch helper for API calls)
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
| Change API call patterns        | `lib/api-client.ts`                                                  | `nxFetch` wraps fetch with auth headers + CSRF                             |

## CLIENT/SERVER BOUNDARY

- **UI primitives** (`ui/*.tsx`) are NOT marked `"use client"` — they are neutral components. Consuming pages decide the boundary.
- **Views** (collection-_, media-_, settings-_, dashboard-_, layout/\*) ARE marked `"use client"` — they use hooks, state, and browser APIs.
- **Heavy editors** are lazy-loaded in `field-renderer.tsx`:
  - `React.lazy(() => import("@nexpress/editor/client"))` for rich-text
  - `React.lazy(() => import("@nexpress/blocks/client"))` for block editor
  - This prevents bundling Lexical + dnd-kit unless the field type is actually used.
- The `client.ts` entry is built by tsup with `"use client"` banner. Consumers import `@nexpress/admin/client`.

## CONVENTIONS

- **`@nexpress/core` is types-only here** — admin imports `type { NxCollectionConfig, NxFieldConfig, ... }` from core. Never import runtime/server exports from core. All data access goes through HTTP API calls to `/api/*`.
- **`next-shim.d.ts`** exists because this package uses `next/link` and `next/navigation` but is built outside a Next app. Do not remove it — tsc will fail.
- **`.js` extensions** in all relative imports (NodeNext resolution).
- **`as never` casts** exist in `field-renderer.tsx` and `fields/array-field-editor.tsx` for complex generic intersections. Minimize but don't add more.

## ANTI-PATTERNS

- **Never import runtime exports from `@nexpress/core`** — only type imports. This package runs in the browser.
- **Never mark UI primitives with `"use client"`** — keep them boundary-neutral.
- **Never import `@nexpress/editor/client` or `@nexpress/blocks/client` statically** — always use `React.lazy` dynamic imports to avoid client bundle bloat.
