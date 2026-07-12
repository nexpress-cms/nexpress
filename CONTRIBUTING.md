# Contributing to NexPress

Thanks for your interest. The repo conventions live in
[`AGENTS.md`](./AGENTS.md) (architecture overview, file map, anti-patterns)
and the per-subsystem guides under [`docs/`](./docs/). This file covers
the contribution mechanics: setup, branching, versioning, and releases.

## Setup

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d db    # Postgres 16 on :5433
cp .env.example .env
# Replace NP_SECRET with 32+ random characters, e.g. `openssl rand -hex 32`.
pnpm build       # populate dist/ for every workspace
pnpm dev         # turbo watch (tsup --watch + next dev)
```

`pnpm test` runs the vitest unit suite (no DB). `pnpm test:integration`
runs the Postgres-backed suite, gated on `TEST_DATABASE_URL` — see
[`docs/testing.md`](./docs/testing.md).

## Branching + PRs

- Branch off `main`. Use a topic prefix that reflects intent: `feat/`,
  `fix/`, `refactor/`, `chore/`, `docs/`.
- One concern per PR. If you find unrelated cleanup along the way, open
  a separate PR for it.
- Every PR runs typecheck + tests locally before opening. CI enforces
  the same.
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

| Change type                                                | Add a changeset? |
| ---------------------------------------------------------- | ---------------- |
| Public API addition / change / removal                     | Yes              |
| Behavior change visible to a `@nexpress/*` consumer        | Yes              |
| New collection field type, new block, new plugin hook      | Yes              |
| Config option added / renamed / removed                    | Yes              |
| Internal refactor with no consumer-visible difference      | No               |
| Test, doc, CI, or build-script change                      | No               |
| `apps/web` only (the reference app — `ignore` in config)   | No               |

When in doubt, add one.

## Release flow (maintainer)

Today: local-only while GitHub Actions billing is locked.

```bash
pnpm version    # consume pending changesets → bump versions + write CHANGELOG.md
pnpm release    # build + npm publish
```

`pnpm release` runs `pnpm build` first via `prepublishOnly`, so the
tarballs always match the source.

Future: `.github/workflows/release.yml` is wired and will take over
once Actions billing is resolved and the `push: main` trigger is
restored. When active it runs the changesets action on every push to
`main`: queued changesets → "Version Packages" PR; merging that PR →
publish to npm with `--provenance` attestation.

### Publish order

The CLI scaffolder pins runtime deps to `latest`, so `create-nexpress`
must publish **after** the framework packages. Order:

1. `@nexpress/core`
2. `@nexpress/editor`, `@nexpress/theme`, `@nexpress/plugin-sdk`,
   `@nexpress/next`, `@nexpress/wp-import`, `@nexpress/xliff`
3. `@nexpress/blocks`
4. `@nexpress/admin`
5. `create-nexpress`
6. `@nexpress/plugin-*`, `@nexpress/theme-*`

`pnpm release` (via `changeset publish`) does this automatically by
walking the workspace dependency graph.

## Testing checklist before opening a PR

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
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
