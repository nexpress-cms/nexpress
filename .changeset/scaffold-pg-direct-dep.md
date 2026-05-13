---
"create-nexpress": patch
---

Add `pg` as a direct dependency in scaffolded projects. The migration runner introduced in the previous patch (`scripts/run-migrations.ts`) does `import pg from "pg"`, which under pnpm 10's strict hoisting can't resolve through `@nexpress/core`'s nested copy on a fresh scaffold — a clean `npx create-nexpress … && pnpm install && pnpm setup` died with `ERR_MODULE_NOT_FOUND: Cannot find package 'pg'`. Promoting `pg` to a top-level dep guarantees the bare specifier resolves.

apps/web already had it transitively through workspace hoisting, but pin it explicitly there too for consistency and to dogfood the same install shape.
