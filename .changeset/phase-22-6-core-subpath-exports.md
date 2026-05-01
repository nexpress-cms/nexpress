---
"@nexpress/core": minor
---

Phase 22.6 — domain-bounded subpath exports for `@nexpress/core`.

The single root `index.ts` had grown to ~91 export blocks across DB,
auth, community, jobs, i18n, media, observability, and SEO surfaces.
For a published package, that's a v1 commitment to the entire mixture.
This carves the surface into subpath entries so consumers can reach a
single domain without pulling in the others' types and so future
deprecations are scoped per domain:

  - `@nexpress/core/auth`          — capabilities, JWT, OAuth, sessions
  - `@nexpress/core/community`     — comments, reactions, reports, bans, …
  - `@nexpress/core/db`            — connection, runtime, schema codegen
  - `@nexpress/core/i18n`          — locales, translations, formatting
  - `@nexpress/core/jobs`          — pg-boss, handlers, heartbeat, pause
  - `@nexpress/core/media`         — service, processor, refs
  - `@nexpress/core/observability` — logger, error reporter, safety check
  - `@nexpress/core/seo`           — sitemap, page metadata, JSON-LD

Additive only — the root `@nexpress/core` continues to re-export
everything in those domains, so existing call sites do not need to
migrate. New code should prefer the subpath that fits its call site.

Two existing aggregator files (`auth/index.ts`, `db/index.ts`) were
incomplete; they now mirror the root re-exports for their domain.
Two new aggregators (`i18n/index.ts`, `seo/index.ts`) were added.
