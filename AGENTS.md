# NexPress agent instructions

## Start with the relevant context

- Follow the user's current instructions and applicable nested `AGENTS.md`.
- Read [the current handoff](docs/agent-guidance/current-handoff.md) for ongoing work; verify Git state before relying on its branch, commit or test results.
- Reuse existing services, contracts, route factories, UI and fixtures. Preserve functionality and group related work around one user-visible outcome.
- Read the relevant detailed guidance section below before editing that area. Search headings and read bounded sections; do not preload all references/history.
- Keep AGENTS.md operational. Put implementation history and test counts in feature flow documents; replace the current handoff instead of appending history.

## Working rules

- Framework identifiers use `np` / `Np` / `NP_` / `np_` / `np-` / `--np-`; package names remain `@nexpress/*`. Preserve existing internal `nx:*` cache/Redis keys where their contracts still require them.
- Use pnpm 10.33 and Node >=20.19.0. Packages are ESM/NodeNext; relative package imports use `.js`. Prefer domain subpaths over server root barrels.
- Keep `@nexpress/core/*-contract` entries browser-safe. Client components may import pure contract values and server types, never server runtime exports. React remains a peer dependency. Never import Admin into public site routes.
- Initialize through `ensureFor("read" | "plugins" | "worker" | "write")` before reading services. Reuse `getDb()`; do not create parallel application pools. Raw setters belong to framework-host bootstrap only.
- Preserve collection pipeline ACLs, validation, hooks and revisions. Never hand-edit generated schemas or `next-env.d.ts`; regenerate from sources and review migration SQL, especially destructive changes.
- Use existing safe `NpError` subclasses/envelopes and cache, storage and observability facades. Do not import `next/cache` directly.
- Durable jobs must persist/validate `siteId` and register `resolveSiteId`; async-local request context does not cross queue/process boundaries.
- Do not suppress type errors with `as any`, `@ts-ignore` or `@ts-expect-error`. Minimize existing `as never` patterns. Keep imports cycle-free and type-only where applicable. Follow repository Prettier and ESLint conventions.
- Agent services remain explicitly host-injected and disabled when absent. Reuse current authority, admission, CSRF, reauthentication, CAS, idempotency, audit and redaction contracts. Never invent Runtime/provider evidence or add automatic activation, workers, credentials or provider calls.

## Build and verification

- `pnpm dev` watches the reference app only; libraries serve built `dist/`. Build changed dependencies before testing consumers. Use filtered package builds/watchers for local work; `pnpm dev:full` is the expensive full watch.
- Use relevant tests during implementation, then `pnpm verify` and `pnpm lint` for the final code gate. `verify` includes repository checks, builds, typechecks and unit tests. Tests/typechecks depend on dependency builds.
- Follow [testing guidance](docs/testing.md) and the affected feature's acceptance gates. Unset integration environment variables can silently skip tests; report skips and explicitly run required PostgreSQL, Redis, theme, native preview, production browser and packed-scaffold checks.
- Do not test against incomplete build output. Keep browser startup/artifact cleanup separate from tools scanning the same directories.
- Self-review, fix discovered issues, rerun affected checks, and run `git diff --check`. Inspect changes for secrets and unintended generated files. Documentation-only restructuring needs preservation/link/format checks, not application builds.

## Commits and releases

- Follow the current user's commit/PR/merge authorization; finishing a sub-step is not authorization. Bundle related changes instead of tiny PRs.
- Current work defers package versions and changesets until the user changes that constraint. The general changeset policy remains in the detailed reference.
- A minor bump of the fixed `@nexpress/*` family requires explicit approval of that exact target minor in the current release discussion. General release authorization and green CI are insufficient. Stop before merging/publishing an unapproved Version PR and identify its versions and contributing changesets.
- Ordinary and Version PRs use squash. Dependabot PRs use `pnpm merge:dependabot -- <pr>` after four passing checks, including its exact-head approval token and post-merge CI/Release verification.
- Before publishing or changing a public API, read the release, stability and CI guidance below. This document does not grant deployment authority.

## Read only what the task needs

| Area                                                                                                      | Detailed guidance                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup, commands and watch/build behavior                                                                  | [Commands](docs/agent-guidance/reference/root.md#commands)                                                                                                                                                                           |
| Package graph, exports, singletons, collections, plugins, rendering, SEO, search, storage, email and jobs | [Architecture](docs/agent-guidance/reference/root.md#architecture), then the relevant subsection                                                                                                                                     |
| Finding implementation owners                                                                             | [Where to look](docs/agent-guidance/reference/root.md#where-to-look)                                                                                                                                                                 |
| Public contracts and releases                                                                             | [Stability](docs/agent-guidance/reference/root.md#stability-pre-10), [release authorization](docs/agent-guidance/reference/root.md#release-authorization-hard-rule), [CI/release notes](docs/agent-guidance/reference/root.md#notes) |
| Core services                                                                                             | [packages/core/AGENTS.md](packages/core/AGENTS.md)                                                                                                                                                                                   |
| Admin components                                                                                          | [packages/admin/AGENTS.md](packages/admin/AGENTS.md)                                                                                                                                                                                 |
| Shared app/reference/scaffold wiring                                                                      | [apps/web/AGENTS.md](apps/web/AGENTS.md)                                                                                                                                                                                             |
| Agent Platform contracts                                                                                  | [Roadmap](docs/design/agentic-platform/implementation-roadmap.md), then the affected design/flow document                                                                                                                            |
| Historical evidence                                                                                       | [History index](docs/agent-guidance/README.md#preserved-history-and-guidance); not required for routine startup                                                                                                                      |

## Task boundaries

Update the [handoff](docs/agent-guidance/current-handoff.md) using the [template](docs/agent-guidance/handoff-template.md) only when transitioning sessions; do not rewrite it after every bundle or merge. Start the next bundle in a fresh thread when the user requests it. Preserve uncommitted work and explicit constraints; never assume a new worktree contains pending changes. Do not fork the entire old conversation merely to carry implementation history.
