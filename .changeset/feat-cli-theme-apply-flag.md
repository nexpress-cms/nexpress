---
"@nexpress/cli": minor
---

**v0.3 (B) — `--apply` flag for `theme:install` and `theme:uninstall`.**

Closes a v0.3-deferred item from `docs/design/theme-v0.2-extension.md`
§10:

> `theme:install` auto-chains `db:migrate` — v0.2 keeps the DB-write
> boundary explicit so the operator reviews the staged collection
> diff (and the generated migration SQL) before it hits the database.
> A `--apply` flag … is a clean v0.3 addition once the safety story
> for AST patching has shipped real-world miles.

### What changed

| Command | Default | `--apply` |
|---|---|---|
| `theme:install` | AST-patch → `db:generate` → STOP. Operator runs `db:migrate` manually. | AST-patch → `db:generate` → `db:migrate`. One-shot install. |
| `theme:uninstall` | AST-unpatch → `db:generate` → STOP. Operator runs `db:migrate` manually after reviewing DROP COLUMN. | AST-unpatch → `db:generate` → `db:migrate`. The DROP COLUMN runs. |

The default stays explicit — operators new to NexPress get the
safety net of reviewing generated SQL before it touches the
database. `--apply` is opt-in for operators who've shipped enough
theme installs to trust the staged diff.

### Confirm-prompt copy

When `--apply` is set, the confirmation prompt explicitly mentions
"will also run db:generate AND db:migrate" so the operator sees the
full impact before pressing `y`. For uninstall, the destructive
warning gains "(the latter DROPs columns)".

### Failure modes

| Phase | Behavior |
|---|---|
| Generate fails | `--apply` skipped; manual hint printed, exit 0 (the AST changes are still in place; operator fixes generate then runs migrate manually) |
| Migrate fails (with `--apply`) | Exit 1; operator reviews `git diff` and runs `pnpm db:migrate` manually after reconciling |

### Combined with `--yes`

Orthogonal flags. `--yes --apply` makes the install/uninstall fully
non-interactive (CI-friendly). `--apply` alone still prompts.
`--yes` alone still stops after `db:generate`.
