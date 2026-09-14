# Reference app agent instructions

This Next.js reference app supplies local config, collections, generated schema and package wiring. Shared handlers, pages, scripts, proxy and setup implementations belong in `packages/app`; reference/scaffold files remain thin wrappers.

- Read the applicable [reference app guidance](../../docs/agent-guidance/reference/web.md) before changing bootstrap, auth, route or schema wiring.
- Use `ensureFor` from `@/lib/init-core`: `read` for DB/storage/collections, `plugins` for plugin rendering, `write` for mutations/email/producer, and `worker` only for dedicated workers. Standalone scripts must shut down bootstrap.
- Reuse `getDb()` after initialization. Never create another pool or hand-edit generated collections or `next-env.d.ts`.
- Change shared behavior in `packages/app/src/**`, then keep reference and CLI snapshot wrappers aligned. Do not copy shared implementations into the app without an actual project-specific divergence.
- Staff auth uses `np-session`, `np-refresh`, `np-csrf`; members use existing member helpers and `np-mb-*` cookies. API mutation CSRF is centralized in `packages/app/src/proxy/index.ts`; add per-handler checks only for an intentional proxy bypass.
- Server parents resolve capabilities with `can(user, capability)` and pass flags to client shells. Do not import server Core runtime into clients or Admin into public site routes.
- Use `revalidateCollection()` or shared cache helpers, not direct `next/cache` imports.
- Agent routes reuse current-site staff admission and explicitly installed services. Runtime keys, definitions, intent and verification remain host-injected; wrappers must not enable services, workers or Gateway exposure.
- PostgreSQL tests require an isolated test database; verify optional test gates rather than counting skips as passes. Browser fixtures reuse existing authentication and rate-limit isolation patterns without weakening product limits.

Use [Structure](../../docs/agent-guidance/reference/web.md#structure) and [Where to look](../../docs/agent-guidance/reference/web.md#where-to-look) for owner paths. Consult the [current handoff](../../docs/agent-guidance/current-handoff.md) for pending changes and acceptance evidence; earlier notes are [archived](../../docs/agent-guidance/history/web.md).
