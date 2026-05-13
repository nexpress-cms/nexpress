---
"create-nexpress": patch
---

Replace `drizzle-kit migrate` with a direct `drizzle-orm` migrate runner in scaffolded projects (`scripts/run-migrations.ts`). The drizzle-kit CLI swallows SQL errors as a silent `exit 1` under non-TTY (which is exactly what `pnpm setup`'s spawn produces) — burning first-time operators with "migration failed" and no actionable message. The library function (`migrate()` from `drizzle-orm/node-postgres/migrator`) throws a real `Error` whose `cause` carries the underlying pg error plus its sqlstate code (e.g. `42P07` for duplicate-table), which the new runner prints to stderr.

Schema state is unchanged: same `./drizzle/` folder, same `drizzle.__drizzle_migrations` tracking. Only error fidelity changes. `setup-server.ts` now spawns `pnpm exec tsx ./scripts/run-migrations.ts` instead of `pnpm exec drizzle-kit migrate`; operators running migrations directly (`pnpm db:migrate`) still hit the CLI, which is fine when they have a real terminal.

Adds `@types/pg` as a devDependency so the new runner typechecks. The runtime `pg` dependency is already in the install graph via `@nexpress/core`.
