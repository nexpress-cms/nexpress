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
| [backup-restore.md](backup-restore.md)                 | Backup procedures, restore order, DR drill                             |
| [block-content.md](block-content.md)                   | Stable block-content wire format and validation boundaries             |
| [caching.md](caching.md)                               | Cache strategy and invalidation                                        |
| [community.md](community.md)                           | Community / member features (live behavior)                            |
| [deployment.md](deployment.md)                         | Production deployment notes                                            |
| [email.md](email.md)                                   | Email adapters and templates                                           |
| [i18n.md](i18n.md)                                     | Internationalization                                                   |
| [jobs.md](jobs.md)                                     | pg-boss-backed job queue                                               |
| [media.md](media.md)                                   | Canonical media records, variants, URLs, API, and ops contract         |
| [multi-site.md](multi-site.md)                         | Multi-tenant site model                                                |
| [navigation.md](navigation.md)                         | Navigation wire/resolved types, validation, and enforcement boundaries |
| [observability.md](observability.md)                   | Logging, heartbeats, job logs                                          |
| [operations.md](operations.md)                         | Operations runbook — incident recipes, boot warnings, recovery         |
| [plugin-admin.md](plugin-admin.md)                     | Plugin admin UI surface                                                |
| [plugin-api-routes.md](plugin-api-routes.md)           | Typed plugin HTTP route and response contracts                         |
| [plugin-capabilities.md](plugin-capabilities.md)       | Capability ↔ `ctx.*` mapping reference                                 |
| [plugin-hooks.md](plugin-hooks.md)                     | Typed content, auth, media lifecycle hook payloads                     |
| [plugin-manifest.md](plugin-manifest.md)               | Manifest field reference (required vs auto-defaulted)                  |
| [plugin-quickstart.md](plugin-quickstart.md)           | Author your first plugin in ~10 minutes                                |
| [plugin-reload.md](plugin-reload.md)                   | What `/admin/plugins` "Reload all" picks up (and what needs a restart) |
| [plugin-render.md](plugin-render.md)                   | Plugin render hooks                                                    |
| [releasing.md](releasing.md)                           | Changesets release and npm publish checklist                           |
| [revisions.md](revisions.md)                           | Revision snapshots, autosave, restore, API, and doctor contracts       |
| [rich-text.md](rich-text.md)                           | Versioned rich-text wire format, validation, and authoring helpers     |
| [scheduled-publishing.md](scheduled-publishing.md)     | Scheduled publish flow                                                 |
| [settings.md](settings.md)                             | Canonical site identity and closed persisted-settings registry         |
| [site-customization.md](site-customization.md)         | Track A — what to customise in a scaffolded site without forking       |
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
v0.1 stability _contract_ is in `AGENTS.md`; current behavior lives in the
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

```
design/
  community-design.md          — original community/member-system rationale
  nexpress-core-design.md      — original 2026-04-17 core design (203 KB)
  plugin-system-design.md      — original plugin-system design
  wordpress-import-design.md   — Phase 21 import rationale
  nexpress.txt                 — original v3 product brief (Korean)
  nexpress-summary.txt         — v3 brief summary (Korean)
```
