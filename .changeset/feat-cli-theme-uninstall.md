---
"@nexpress/cli": minor
---

**F.8 — `nexpress theme:uninstall <package>`.**

The inverse of `theme:install`. Reverses the AST changes the
installer made: removes theme-contributed fields from the
operator's collection files, and (with `--with-collections`)
deletes whole collection files when their on-disk shape
matches the theme's spec exactly.

### What it does

| Step | Default | `--with-collections` |
|---|---|---|
| AST-remove fields the theme requires | yes | yes |
| Delete `src/collections/<slug>.ts` files matching theme spec | no | yes (only when the file has no operator extras) |
| Run `pnpm db:generate` so a DROP COLUMN migration is staged | yes | yes |
| Run `pnpm db:migrate` (data-loss step) | **no — operator's call** | **no — operator's call** |
| Run `pnpm remove <pkg>` | no | no |
| Edit `themes:` array / collection imports in `nexpress.config.ts` | no | no |

The CLI never touches the database directly and never runs
`pnpm remove`. Both are operator decisions: the migration
contains DROP COLUMN statements that drop data, and the
package can stay installed for a re-install round-trip.

### Safety

- **Stateless plan, like install.** The planner reads the
  theme manifest's `requires` and the operator's current
  collections and proposes changes. It can't tell theme-
  contributed fields apart from operator-authored ones with
  the same name — so the plan is shown explicitly and confirmed.
- **`--with-collections` is gated.** Whole-file deletion only
  runs when the on-disk fields match the theme's spec exactly.
  Operators who added their own fields to a theme-installed
  collection get `keep-collection-with-warning` instead, and
  only the theme-contributed fields come out.
- **Idempotent.** Re-running on a partially-cleaned site
  reports `idempotent skip` and exits cleanly.
- **Atomic per file.** AST-unpatch saves once at the end of
  each file; a thrown error before save leaves the file
  untouched.
- **Non-TTY without `--yes` errors.** Mirrors install's
  guard against silent CI runs that "succeed" without
  applying.
- **Clear destructive copy.** The plan output leads with a
  red "next migration will DROP COLUMN" warning so operators
  know what hitting `y` actually costs.

### CLI flags

```
nexpress theme:uninstall <package>
nexpress theme:uninstall <package> --dry-run            # print plan, exit
nexpress theme:uninstall <package> --yes                # skip confirm
nexpress theme:uninstall <package> --with-collections   # delete files too
```

### Tests

15 new unit tests:
- 8 in `theme-uninstall/plan.test.ts` covering noop / idempotent
  re-run / per-field removal / `--with-collections` (matches /
  extras / off) / theme-metadata pass-through
- 7 in `theme-uninstall/ast/unpatch-collection.test.ts` covering
  single + multiple removal / idempotent / `row` + `collapsible`
  containers / throw on dynamic `fields` / no-save when nothing
  matched

Total `@nexpress/cli` tests: 82 (was 67).

### Caveats

- Theme package must still be installed when `theme:uninstall`
  runs (we read the manifest via dynamic import). Run
  `theme:uninstall` BEFORE `pnpm remove`. The CLI shows this
  hint when the import fails.
- `nexpress.config.ts` is never touched. Operators remove the
  `themes:` array entry and the `import` lines manually after
  the CLI is done.
