---
"@nexpress/core": minor
"@nexpress/theme": minor
"@nexpress/web": patch
---

feat(theme, core, web): M.3 — `impl.members.notFound` / `impl.members.error` slots

Third phase of the F-track member-surface skinning. Themes can now ship a member-tree-specific 404 page and error boundary, mirroring the v0.2 `impl.notFound` / `impl.error` slots (F.7 / F.7.1) for the `(member)/members/*` subtree.

**Theme contract additions** (`@nexpress/theme` `NpThemeImpl.members`):

```ts
members?: {
  shell?: ComponentType<NpThemeShellProps> | null;
  pageTitle?: { ... };
  notFound?: ComponentType;                      // NEW (M.3)
  error?: ComponentType<NpThemeErrorProps>;      // NEW (M.3) — forward-compat marker
};
```

**Fallback chain** for `members.notFound`:

1. `impl.members.notFound` declared → use it
2. `impl.members.notFound === undefined` → fall back to `impl.notFound`
3. `impl.notFound === undefined` → framework default (the JSX in `(member)/not-found.tsx`)

The framework default is tuned for the member surface — the CTA points to `/members/login` rather than the public site's "go home" default. Most "page not found" hits inside `/members/*` are stale auth links (expired verify tokens, old reset-password emails opened twice); a "go home" CTA misroutes those.

**Core API surface** (`@nexpress/core`):

- `extractMembersNotFoundComponent(impl)` — pure structural narrower with the fallback chain (member-level → top-level → null). Mirrors `extractNotFoundComponent` shape, treats `impl` as opaque (`unknown`); the consumer in `apps/web` casts to `ComponentType` at the JSX site.
- `getActiveThemeMembersNotFound()` — async sugar over the active theme. Returns the resolved component reference (or `null` when neither slot is declared).

**Files**:

- `apps/web/src/app/(member)/not-found.tsx` (NEW) — server component, delegates to `getActiveThemeMembersNotFound()`, falls through to the framework default
- `apps/web/src/app/(member)/error.tsx` (NEW) — `"use client"` + lazy `THEME_MEMBER_ERRORS` registry shape (parallel to `(site)/error.tsx`'s F.7.1 pattern). Registry starts empty — reference theme adoption (`./components/members-error` subpath in magazine) lands in M.ref.
- `(member)/error.tsx` keeps its OWN registry rather than inheriting `(site)/error.tsx`'s `THEME_ERRORS` map. Coupling the two would force every theme that ships a public-site error subpath to also ship a members-error subpath even when the public default is fine for both.

**5 unit tests** added covering the fallback chain (no impl / no slots / member-level wins / top-level fallback / non-function rejection). 361 tests pass total (was 356).

**Reference theme adoption** (magazine shipping `./components/members-error` + a custom `members.notFound`) lands in M.ref. Existing themes with no `impl.members.notFound` declared continue to work — the fallback chain hits step 2 or 3.
