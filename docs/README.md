# docs/

Two distinct kinds of documentation live here. The split is load-bearing:
mistaking one for the other has bitten newcomers, which is what motivated
issue #276.

## Live guides — kept current

These describe how the system **actually works today**. Update them when the
behavior they describe changes.

| File                                                   | Topic                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| [agent-integration.md](agent-integration.md)           | Agent / LLM integration surface                                        |
| [agent-operated-ops.md](agent-operated-ops.md)         | Shipped agent-operated ops CLI, mutation, and admin API contracts      |
| [api-error-codes.md](api-error-codes.md)               | Stable `code` strings on error responses                               |
| [authentication.md](authentication.md)                 | Staff/member JWT, cookie, session-row, and invalidation contracts      |
| [backup-restore.md](backup-restore.md)                 | Backup procedures, restore order, DR drill                             |
| [block-content.md](block-content.md)                   | Stable block-content wire format and validation boundaries             |
| [bootstrap.md](bootstrap.md)                           | Intent-based process runtime, host boundary, and shutdown lifecycle    |
| [caching.md](caching.md)                               | Cache strategy and invalidation                                        |
| [community.md](community.md)                           | Community / member features (live behavior)                            |
| [collection-documents.md](collection-documents.md)     | Exact storage, runtime, wire, query, and diagnostics contracts         |
| [content-transfer.md](content-transfer.md)             | Exact v3 content portability and import preflight                      |
| [custom-routes.md](custom-routes.md)                   | Code-owned route registry and Admin wire contract                      |
| [deployment.md](deployment.md)                         | Production deployment notes                                            |
| [email.md](email.md)                                   | Email adapters and templates                                           |
| [i18n.md](i18n.md)                                     | Internationalization                                                   |
| [in-page-editor.md](in-page-editor.md)                 | In-page block editing modes, interactions, and test coverage           |
| [jobs.md](jobs.md)                                     | pg-boss-backed job queue                                               |
| [media.md](media.md)                                   | Canonical media records, variants, URLs, API, and ops contract         |
| [multi-site.md](multi-site.md)                         | Multi-tenant site model                                                |
| [navigation.md](navigation.md)                         | Navigation wire/resolved types, validation, and enforcement boundaries |
| [observability.md](observability.md)                   | Logger/reporter runtime contracts, lifecycle, diagnostics, worker logs |
| [operations.md](operations.md)                         | Operations runbook — incident recipes, boot warnings, recovery         |
| [plugin-admin.md](plugin-admin.md)                     | Plugin admin UI surface                                                |
| [plugin-api-routes.md](plugin-api-routes.md)           | Typed plugin HTTP route and response contracts                         |
| [plugin-blocks.md](plugin-blocks.md)                   | Plugin block definitions, props schemas, and registry behavior         |
| [plugin-capabilities.md](plugin-capabilities.md)       | Capability ↔ `ctx.*` mapping reference                                 |
| [plugin-hooks.md](plugin-hooks.md)                     | Typed content, auth, media lifecycle hook payloads                     |
| [plugin-i18n.md](plugin-i18n.md)                       | Definition-level plugin ICU catalogs and locale validation             |
| [plugin-manifest.md](plugin-manifest.md)               | Manifest field reference (required vs auto-defaulted)                  |
| [plugin-pages.md](plugin-pages.md)                     | Public page routes, matching, shells, and server/client boundaries     |
| [plugin-patterns.md](plugin-patterns.md)               | Page-builder pattern definitions and block-reference validation        |
| [plugin-quickstart.md](plugin-quickstart.md)           | Author your first plugin in ~10 minutes                                |
| [plugin-reload.md](plugin-reload.md)                   | What `/admin/plugins` "Reload all" picks up (and what needs a restart) |
| [plugin-render.md](plugin-render.md)                   | Plugin render hooks                                                    |
| [plugin-scheduled-tasks.md](plugin-scheduled-tasks.md) | Scheduled task ids, UTC cron, dispatch, and diagnostics                |
| [plugin-templates.md](plugin-templates.md)             | Definition-level page templates and reload ownership                   |
| [public-discovery.md](public-discovery.md)             | Exact public block, collection, and plugin discovery wire contracts    |
| [rate-limiting.md](rate-limiting.md)                   | Proxy adapter, request/result, Redis, and multi-node contract          |
| [releasing.md](releasing.md)                           | Changesets release and npm publish checklist                           |
| [revisions.md](revisions.md)                           | Revision snapshots, autosave, restore, API, and doctor contracts       |
| [rich-text.md](rich-text.md)                           | Versioned rich-text wire format, validation, and authoring helpers     |
| [search.md](search.md)                                 | Search request/result, adapter, cache, reindex, and health contracts   |
| [scheduled-publishing.md](scheduled-publishing.md)     | Scheduled publish flow                                                 |
| [seo.md](seo.md)                                       | Page metadata, JSON-LD, sitemap/feed, and theme contribution contracts |
| [settings.md](settings.md)                             | Canonical site identity and closed persisted-settings registry         |
| [site-customization.md](site-customization.md)         | Track A — what to customise in a scaffolded site without forking       |
| [storage.md](storage.md)                               | Runtime modes, object/adapter contract, lifecycle, and diagnostics     |
| [testing.md](testing.md)                               | Unit + integration test setup                                          |
| [theme-and-page-authors.md](theme-and-page-authors.md) | Cookbook — what to call from a custom page or theme                    |
| [theme-authoring.md](theme-authoring.md)               | Authoring a theme                                                      |
| [theme-quickstart.md](theme-quickstart.md)             | Author your first theme                                                |
| [theme-tokens.md](theme-tokens.md)                     | Canonical theme token inventory, validation, and merge boundaries      |
| [troubleshooting.md](troubleshooting.md)               | First-boot and scaffold troubleshooting                                |
| [wordpress-import-guide.md](wordpress-import-guide.md) | Running the WP importer                                                |

The single live "architecture" entry point is [`AGENTS.md`](../AGENTS.md) at
the repo root. `CLAUDE.md` is intentionally ignored as a local compatibility
file for Claude-style tooling; do not put current architecture guidance
there. `AGENTS.md` is the only file in the repo that should claim to be a
current architectural overview.

## Roadmap

[`roadmap.md`](roadmap.md) — historical pre-publish roadmap snapshot. It is
kept for context and category vocabulary, not as the current work queue. The
pre-1.0 stability contract is in `AGENTS.md`; current behavior lives in the
focused live guides above.

[`agent-operated-ops.md`](agent-operated-ops.md) started as a planning
backlog, but now documents the shipped `nexpress ops`, `nexpress release`,
and `nexpress runbook` JSON contracts. Its issue sections are retained as
implementation history and follow-up notes.

## Design snapshots — frozen

Files under [`design/`](design/) are **planning-time snapshots**. They are
preserved for historical motivation but are not kept in sync with the code.
Each one carries a banner at the top noting the last commit the high-level
intent was verified against. Specifics (file paths, function signatures,
schema names, code samples) will have drifted.

If you want to know how something works **right now**, read the code and the
matching live guide above. If you want to know **why** a subsystem is
shaped the way it is, the design snapshot may have the rationale.

The directory currently contains the original core, community, plugin,
WordPress-import, universal-content, theme-extension, member-surface, route,
plugin-config, authoring-field-note, alias-removal, and Phase 23 planning
snapshots, plus the original Korean product brief and summary. The directory
listing is the authoritative inventory; none of these files supersedes a live
guide above.
