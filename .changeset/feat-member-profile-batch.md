---
"@nexpress/core": minor
"@nexpress/web": patch
---

**Phase C dogfood pass — fixes found while migrating real pages onto the new primitives.**

Wrote `/u/[handle]` and `/discussions` against the primitives
shipped in #531; the migration surfaced two friction points that
are worth fixing in the primitive surface (rather than working
around them in every caller) and one cookbook gap.

- **`getMemberProfile(idOrHandle)` now lowercases the input.**
  Member handles are stored lowercase by the registration path
  (`api/members/register/route.ts:49`), so visiting
  `/u/HANDLE` returned `null` even though `/u/handle` worked.
  The lookup now mirrors what every existing read site already
  does explicitly. UUID ids are unaffected (lowercase hex is
  idempotent).

- **New `getMemberProfiles(ids[], opts?)` batch helper** in
  `@nexpress/core/community`. Looping `getMemberProfile` over a
  list-page's authors would issue N queries plus N avatar
  resolutions. The batch fetches the rows in a single SELECT
  and resolves avatars in parallel, returning
  `Map<id, NpMemberProfile>`. Callers like the discussions
  index can drop their ad-hoc Drizzle author-lookup boilerplate
  (`apps/web/src/app/(site)/discussions/page.tsx` now uses the
  batch and is shorter + correct on the avatar field that was
  previously dropped).

- **Cookbook: documented the listing pattern + the
  `joinedAt: Date` serialization caveat.** RSC code that passes
  a profile to a client component crosses the JSON boundary —
  call `.toISOString()` first, or accept `string` on the client
  and parse there.

The dogfood pass also fixed a pre-existing bug in
`/u/[handle]/page.tsx`: the old code passed `member.avatar` (a
UUID FK to `np_media`) directly to `buildPersonJsonLd`'s
`image` field, which expects a URL. The migration to
`getMemberProfile` (which returns `avatarUrl` already resolved)
silently fixes the JSON-LD output. Profile pages now also
actually render the avatar image — the old code only showed
the initial-letter fallback because no URL was available.

Stable in v0.1 — adding optional fields to the option object
is non-breaking; removing or renaming the function rides a
minor with a migration note. `getMemberProfiles` joins
`getMemberProfile` on the v0.1 stability list.
