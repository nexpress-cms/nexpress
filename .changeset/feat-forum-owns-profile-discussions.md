---
"@nexpress/plugin-forum": patch
---

**`/u/<handle>/discussions` moves to the forum plugin.**

The member-profile sub-page that lists a member's published
discussion threads is now part of `@nexpress/plugin-forum`'s
`pageRoutes`. It used to live as a Next.js file route in
`apps/web/src/app/(site)/u/[handle]/discussions/page.tsx`.

Same content, different owner. The route is registered as
`/u/:handle/discussions` (segment count 3, mixed literal +
param) so it doesn't collide with the existing `/discussions/*`
patterns the plugin already owns.

The plugin route uses `cache(getMemberProfile)` from React so
`generateMetadata` and the page render dedupe the member
lookup — same per-request memoization the host's deleted
`getCachedMemberProfile` helper provided.

Removed from `apps/web`:
- `src/app/(site)/u/[handle]/discussions/page.tsx`
- `src/lib/cached-content.ts` (its only consumer was the page
  above; no remaining call sites)

Implication: disabling the forum plugin removes both
`/discussions/*` AND `/u/<handle>/discussions`. The profile
root `/u/<handle>` remains a host concern (general profile
chrome) and works regardless of forum's enabled state.
