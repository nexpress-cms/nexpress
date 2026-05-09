---
"@nexpress/theme-magazine": minor
"@nexpress/web": patch
---

feat(theme-magazine, web): M.ref — magazine reference impl for the M.* member surface

Magazine adopts every M.1-M.3 surface end-to-end. The reference implementation proves the F-track infrastructure works without touching the theme contract.

**`impl.members.shell` — `MagazineMembersShell`**

New server component (`src/members-shell.tsx`) that wraps `(member)/members/*` in the magazine masthead + footer (reuses `MagazineHeader` / `MagazineFooter` so chrome bumps apply to both surfaces) plus a narrow `np-magazine-members-column` (max-width 420px) so auth forms don't stretch to the full editorial column width. Owns the `np-magazine` root wrapper + accent-color inline style — it replaces `impl.shell` for member routes via M.1's fallback chain, so no parent shell is in play.

**`impl.members.notFound` — `MagazineMembersNotFound`**

Tuned voice ("Subscriber desk" / "That link has gone to print" / "Verification and password-reset links expire after a single use…") and a `/members/login` CTA. Replaces the public-site `MagazineNotFound`'s "story isn't in the archive" framing for member routes. Most 404s inside `/members/*` are stale auth links; the new copy speaks to that case.

**`./components/members-error` subpath — `MagazineMembersError`**

`"use client"` component (F.7.1 delegation pattern) that ships at `@nexpress/theme-magazine/components/members-error`. Tone matches the public `./components/error` ("Stop the press" → "Subscriber desk", "Something tore in the layout" → "We lost the thread of your session") and adds a "Back to sign in" button alongside "Try again" — fresh sign-in usually clears the kind of stale-session error this boundary catches.

`apps/web/src/app/(member)/error.tsx`'s `THEME_MEMBER_ERRORS` registry adds the magazine entry: `magazine: lazy(() => import("@nexpress/theme-magazine/components/members-error"))`. The lazy import keeps the magazine error chunk out of the bundle until the boundary fires.

**Token overrides for `--np-member-form-*`**

Magazine's `magazineCss` adds a `.np-magazine .np-members-form { … }` block overriding `--np-member-form-input-bg / -border / -border-focus / -radius` and `--np-member-form-button-radius` to match the editorial squareness (radius 0.25rem, hairline borders, terracotta focus). `.np-form-label` styled with uppercase tracking + serif body font for the magazine voice. Other themes' member forms unchanged — overrides are scoped under `.np-magazine`.

**Package surface changes**

- `package.json` adds the `./components/members-error` exports entry
- `tsup.config.ts` adds `components/members-error` to the client-banner build

**Verified**

- `pnpm --filter @nexpress/theme-magazine build` ✓
- `pnpm typecheck` (58/58) ✓
- Magazine reference implementation now exercises every M.* surface; the M.docs cookbook entry can cite this PR's diff as the canonical migration recipe.

Existing themes (`portfolio`, `docs`) untouched — `impl.members` is optional and they fall back to `impl.shell` / `impl.notFound` per the M.1 / M.3 fallback chains.
