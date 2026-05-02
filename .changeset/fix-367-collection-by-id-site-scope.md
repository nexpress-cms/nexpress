---
"@nexpress/core": patch
---

Scope collection by-id reads and mutations to the current site (#367).

`findDocuments` (the list path) has been site-scoped since Phase 18,
but every by-id pipeline entry was id-only. A staff or member caller
on site A who held or guessed a site B document id could:

- read a site B doc via `getDocumentById` (and its `(site)`
  catch-all dispatcher in `@nexpress/next`)
- update / delete a site B doc via `saveDocument` / `deleteDocument`
- promote a site B pending member doc via `promoteMemberDocument`
- read or seed translations from a site B source via
  `findTranslations` / `createTranslation`

The fix adds the cross-site enforcement at the pipeline's by-id
entry point, so every downstream caller inherits it:

- `getDocumentByIdInternal` (the private write-path loader) now
  resolves the request site, throws `NxForbiddenError(collection,
  "cross-site")` when the loaded row's `siteId` diverges, and
  exposes an explicit `{ allowCrossSite: true }` opt-out for
  legitimate cross-site internal callers (background scripts that
  run without a request site context).
- `getDocumentById` (the public read path) does the same throw —
  matching the assertion shape callers (e.g. `createComment`'s
  Issue #215 path) already use.
- `promoteMemberDocument` also pins `siteId` in the conditional
  UPDATE predicate so the read-check and the write cannot drift.

Translations and the `@nexpress/next` `getCollectionDocument`
helper inherit the protection because they go through
`getDocumentById`. WordPress import (`@nexpress/wp-import`) wraps
its work in `withCurrentSite(payload.siteId, …)` per AGENTS.md, so
the site context matches the doc's `siteId` and the new check
passes naturally — no behavior change for that path.

Test update: `multi-site-scoping.integration.test.ts` "siteId is
sticky" now asserts the cross-site update is rejected outright
(rather than silently ignoring the `siteId` flip in the body), per
the new stricter behavior.
