# Contributing to NexPress

Thanks for your interest. The repo conventions live in
[`AGENTS.md`](./AGENTS.md) (architecture overview, file map, anti-patterns)
and the per-subsystem guides under [`docs/`](./docs/). This file covers
the contribution mechanics: setup, branching, versioning, and releases.

## Setup

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d       # Postgres :5433 + Mailpit :8025
cp .env.example .env
# Replace NP_SECRET with 32+ random characters, e.g. `openssl rand -hex 32`.
pnpm build       # populate dist/ for every workspace
pnpm dev         # apps/web Next dev + collection schema generation
```

`pnpm dev` intentionally watches only the reference app. When editing a leaf
package, use a dependency-aware slice such as
`pnpm --filter @nexpress/admin... dev`; reserve `pnpm dev:full` for a genuine
cross-package refactor because it starts every watcher.

`pnpm test` runs the vitest unit suite (no DB). `pnpm test:integration`
runs the Postgres-backed suite, gated on `TEST_DATABASE_URL` — see
[`docs/testing.md`](./docs/testing.md).

## Branching + PRs

- Branch off `main`. Use a topic prefix that reflects intent; Codex-authored
  branches use the repository's `codex/` prefix.
- One concern per PR. If you find unrelated cleanup along the way, open
  a separate PR for it.
- Run targeted lint/typecheck/tests while iterating, then `pnpm verify` and
  `pnpm format:check` before opening the PR. CI repeats the full build,
  typecheck, unit, integration, E2E, and fresh-scaffold gates.
- Commits use conventional headers (`feat(core): …`, `fix(jobs): …`,
  `docs(deployment): …`) — see `git log` for the in-repo style.

## Versioning policy (pre-1.0)

The canonical policy lives in [`.changeset/README.md`](.changeset/README.md).
While NexPress remains in the `0.x` range, default to `patch` even for ordinary
features. Use `minor` for an intentional milestone or a public API addition
that should be highlighted. Reserve `major` for a breaking change that users
must actively migrate, even before 1.0.

### Fixed-version group

Published workspace packages move together according to the `fixed` array in
[`.changeset/config.json`](.changeset/config.json). Treat that file as the
source of truth rather than duplicating its package inventory here. The
reference app `@nexpress/web` remains private and is not published.

## Changesets

Every user-facing change to a published `@nexpress/*` package ships
with a changeset entry committed in the same PR.

```bash
pnpm changeset
```

The CLI walks you through:

1. Which packages are affected
2. The semver bump for each (most contributions are `patch`)
3. A one-line summary that lands in the package's `CHANGELOG.md`

The result is a markdown file under `.changeset/` — commit it.

### When to add a changeset

| Change type                                              | Add a changeset? |
| -------------------------------------------------------- | ---------------- |
| Public API addition / change / removal                   | Yes              |
| Behavior change visible to a `@nexpress/*` consumer      | Yes              |
| New collection field type, new block, new plugin hook    | Yes              |
| Config option added / renamed / removed                  | Yes              |
| Internal refactor with no consumer-visible difference    | No               |
| Test, doc, CI, or build-script change                    | No               |
| `apps/web` only (the reference app — `ignore` in config) | No               |

When in doubt, add one.

## Release flow (maintainer)

`.github/workflows/release.yml` runs on every push to `main`. Queued
changesets create or update the **Version Packages** PR. That PR is reviewed
and merged separately; its merge runs repository invariants, builds the fixed
package group, publishes through npm Trusted Publishing with provenance, and
creates the release tag.

Do not merge a Version Packages PR as part of an ordinary feature or docs PR.
It is a distinct release decision. See
[`docs/releasing.md`](./docs/releasing.md) for the exact current workflow and
first-publish history.

`pnpm run version` mutates package versions and changelogs, while
`pnpm run release` publishes. Do not run either as an ordinary PR validation
step; use `pnpm verify` and leave versioning/publishing to the dedicated
Version Packages flow.

## Testing checklist before opening a PR

- [ ] Targeted package lint, typecheck, and tests pass while iterating
- [ ] `pnpm verify` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm test:integration` passes if you touched the pipeline,
      community write paths, jobs, or auth
- [ ] If you added a new env var, it's in `.env.example` and named in
      the relevant doc
- [ ] If you added a public API, there's a changeset entry

## Where to read next

- [AGENTS.md](./AGENTS.md) — repo architecture, anti-patterns,
  "where to look" map
- [docs/](./docs/) — live guides per subsystem
- [docs/operations.md](./docs/operations.md) — incident recipes
