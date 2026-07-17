# Changesets

This folder is the source of truth for user-facing version changes. Anything
that affects a published `@nexpress/*` package's external API, behavior, or
build output should ship with a changeset entry committed alongside the code.

## When to add a changeset

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

## How

```bash
pnpm changeset
```

The CLI walks you through (1) which packages are affected, (2) the
[semver bump](https://semver.org/) for each (`patch` / `minor` / `major`),
and (3) a one-line summary that lands in the `CHANGELOG.md` for that
package. The result is a markdown file under `.changeset/` — commit it.

### Semver guidance (pre-1.0)

Until any `@nexpress/*` package reaches `1.0`, **default to `patch`** —
even for new features. Reasons:

- **`fixed` group cascades.** Published workspace packages currently move
  together according to [`.changeset/config.json`](config.json); a single
  `minor` pulls the whole group up. The 0.1.0 → 0.2.0 jump on a single
  first-time-UX feature in `@nexpress/admin` taught us this the hard way.
  Every publishable `@nexpress/*` workspace package belongs to that one group;
  `pnpm test:repo` rejects missing, private, duplicate, or stale entries before
  Changesets can generate or publish a misaligned release.
- **0.x means everything is "subject to change" by semver
  convention.** Operators don't expect `0.1.x → 0.2.x` to be a "new
  features" boundary — they read it as breaking. Save `minor` for
  bumps where you actively want to signal "this is a meaningful
  milestone."
- **Patch is reversible, minor isn't.** If a `minor` bump publishes
  prematurely, the only way back is a revert + new bump.

Reserve `minor` for: deliberate "milestone" releases (e.g. `0.2.0`
when M-track or G-track lands as a whole), or genuinely API-shape
additions you want highlighted in the changelog.

Reserve `major` for: actually-breaking changes the user must
migrate for, even pre-1.0.

`@nexpress/web` is the private reference app, so it is not published.

## Release flow (maintainer)

```bash
pnpm run version    # consume pending changesets → bump versions + write CHANGELOG.md
pnpm run release    # build + npm publish
```

## Status today

Published `@nexpress/*` packages ship through the Release workflow on `main`.
Use changeset files as the running CHANGELOG until a version PR consumes them.

For background on how changesets work, see the
[official docs](https://github.com/changesets/changesets).
