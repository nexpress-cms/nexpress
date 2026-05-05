---
"@nexpress/admin": minor
"@nexpress/web": minor
---

Page-builder patterns — server-side storage (#467 follow-up).

Patterns now persist in `np_settings` per site, shared across
operator accounts and devices, instead of being trapped in one
browser's `localStorage`. localStorage stays as a fallback for
offline use, lower-role accounts, and unreachable APIs.

`@nexpress/web`:

- New `GET /api/admin/patterns` — returns site-shared patterns.
- New `POST /api/admin/patterns` — upsert a pattern by id;
  generates an id when the body omits one; preserves
  `createdAt` on overwrite.
- New `DELETE /api/admin/patterns/:id` — removes a pattern;
  treats missing-id as a no-op success so optimistic UI
  doesn't have to special-case races.

All three are `admin.manage`-gated. CSRF auto-applied via the
existing `apps/web/src/proxy.ts` pipeline. Storage shape: a
single JSON-array value under `np_settings.key =
"page-builder.patterns"`, scoped by `siteId` so multi-tenant
deployments don't leak compositions across tenants.

`@nexpress/admin`:

- New `fetchServerPatterns()`, `saveServerPattern()`,
  `deleteServerPattern()` helpers in
  `packages/admin/src/blocks/patterns.ts`. Each falls back to
  `null` / `false` on network or auth failure so callers can
  drop into local-only mode without crashing.
- Block page editor merges server + local patterns when the
  command menu opens. Server patterns take precedence on id
  collision; local-only patterns surface alongside them so a
  pattern saved while offline is still reachable.
- "Save as pattern" tries the server first; on failure it falls
  back to localStorage so the operator's intent isn't lost.

Backward compatible. Existing localStorage patterns keep working
unchanged — nothing migrates them to the server automatically
(operators can re-save locally-stored patterns to push them up).
