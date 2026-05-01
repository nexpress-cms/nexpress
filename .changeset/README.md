# Changesets

This folder is the source of truth for user-facing version changes. Anything
that affects a published `@nexpress/*` package's external API, behavior, or
build output should ship with a changeset entry committed alongside the code.

## When to add a changeset

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

## How

```bash
pnpm changeset
```

The CLI walks you through (1) which packages are affected, (2) the
[semver bump](https://semver.org/) for each (`patch` / `minor` / `major`),
and (3) a one-line summary that lands in the `CHANGELOG.md` for that
package. The result is a markdown file under `.changeset/` — commit it.

`@nexpress/web` (the reference app) is in the `ignore` list, so you'll
never need to bump it.

## Release flow (maintainer)

```bash
pnpm version    # consume pending changesets → bump versions + write CHANGELOG.md
pnpm release    # build + npm publish (only if packages are public; many are still private)
```

## Status today

All `@nexpress/*` packages are currently `"private": true`. The changeset
workflow is wired up so that as packages flip to public (Phase 22 follow-ups),
their first release picks up the accumulated changeset entries. Until then,
treat changeset files as the running CHANGELOG.

For background on how changesets work, see the
[official docs](https://github.com/changesets/changesets).
