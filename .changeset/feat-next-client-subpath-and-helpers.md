---
"@nexpress/next": minor
---

**PRT.3a — `@nexpress/next` gains a `./client` subpath + lifts
host helpers (#623).**

Foundational refactor for PRT.3b (forum-plugin route migration).
The forum plugin (and any other plugin that wants to register
`pageRoutes`) needs Server-Component-friendly access to member
identity, JSON-LD output, and the comment widget. Those used to
live in `apps/web/`; they're now part of `@nexpress/next`'s
public surface.

**New on the root entry (server-safe):**

- `getSiteMember()` — Server-Component variant of the existing
  `optionalMember` helper. Reads the `np-mb-session` cookie via
  `next/headers`, verifies the JWT, returns the active member or
  null. Caller must have already bootstrapped the framework
  (`ensureFor("read")` or equivalent); the helper reads `getDb()`
  directly. Returns null silently if the DB singleton hasn't
  been set, so a misordered call fails closed rather than
  throwing.
- `JsonLd` — `<script type="application/ld+json">` wrapper.
  Identical implementation to the previous `apps/web` version.

**New `./client` subpath (with `"use client"` banner injection):**

- `Comments` — public-site comment block. Lists visible comments
  under a document, lets a logged-in member post / react /
  report. Self-contained (only React imports, no host paths).

The new entry follows `@nexpress/admin`'s tsup pattern: a
second build target with `esbuildOptions.banner = { js: '"use
client";' }` and externals for React + Next.js. Output is
`dist/client.js` + matching `.d.ts`.

**Breaking-ish: removed from `apps/web`:**

- `apps/web/src/lib/site-member.ts` — call sites updated to
  import from `@nexpress/next`. The old wrapper called
  `await ensureFor("read")` internally; the new helper does not,
  so `apps/web/src/app/(member)/members/me/notifications/page.tsx`
  gained an explicit `await ensureFor("read")` call (the only
  site that didn't already do it).
- `apps/web/src/components/json-ld.tsx` — deleted.
- `apps/web/src/components/comments.tsx` — deleted (moved into
  `@nexpress/next/src/comments.tsx`).

Routes touched (import-path swap only):

- 3 member routes (login, register, me/notifications)
- 4 discussion routes (list, new, [slug], [slug]/edit)
- blog [slug], u [handle], catch-all [[...slug]]

This commit is a **prerequisite for the actual route migration
to the forum plugin** (PRT.3b). Without `@nexpress/next/client`
exposing `Comments`, the forum plugin wouldn't be able to
render the discussion-detail page; without `getSiteMember` on
the public surface, plugin route components couldn't do member
auth in a Server Component context.
