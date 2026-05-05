# docs/

Two distinct kinds of documentation live here. The split is load-bearing:
mistaking one for the other has bitten newcomers, which is what motivated
issue #276.

## Live guides — kept current

These describe how the system **actually works today**. Update them when the
behavior they describe changes.

| File | Topic |
| --- | --- |
| [agent-integration.md](agent-integration.md) | Agent / LLM integration surface |
| [api-error-codes.md](api-error-codes.md) | Stable `code` strings on error responses |
| [backup-restore.md](backup-restore.md) | Backup procedures, restore order, DR drill |
| [caching.md](caching.md) | Cache strategy and invalidation |
| [community.md](community.md) | Community / member features (live behavior) |
| [deployment.md](deployment.md) | Production deployment notes |
| [email.md](email.md) | Email adapters and templates |
| [i18n.md](i18n.md) | Internationalization |
| [jobs.md](jobs.md) | pg-boss-backed job queue |
| [multi-site.md](multi-site.md) | Multi-tenant site model |
| [observability.md](observability.md) | Logging, heartbeats, job logs |
| [operations.md](operations.md) | Operations runbook — incident recipes, boot warnings, recovery |
| [plugin-admin.md](plugin-admin.md) | Plugin admin UI surface |
| [plugin-capabilities.md](plugin-capabilities.md) | Capability ↔ `ctx.*` mapping reference |
| [plugin-manifest.md](plugin-manifest.md) | Manifest field reference (required vs auto-defaulted) |
| [plugin-quickstart.md](plugin-quickstart.md) | Author your first plugin in ~30 minutes |
| [plugin-reload.md](plugin-reload.md) | What `/admin/plugins` "Reload all" picks up (and what needs a restart) |
| [plugin-render.md](plugin-render.md) | Plugin render hooks |
| [releasing.md](releasing.md) | Changesets release and npm publish checklist |
| [scheduled-publishing.md](scheduled-publishing.md) | Scheduled publish flow |
| [testing.md](testing.md) | Unit + integration test setup |
| [theme-authoring.md](theme-authoring.md) | Authoring a theme |
| [wordpress-import-guide.md](wordpress-import-guide.md) | Running the WP importer |

The single live "architecture" entry point is [`AGENTS.md`](../AGENTS.md) at
the repo root (symlinked as `CLAUDE.md`). It is the only file in the repo
that should claim to be a current architectural overview.

## Roadmap

[`roadmap.md`](roadmap.md) — the working roadmap from 0.1 toward 1.0.
Updated as work lands. The v0.1 stability *contract* is in `AGENTS.md`;
the roadmap is what we plan to do *next*.

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
