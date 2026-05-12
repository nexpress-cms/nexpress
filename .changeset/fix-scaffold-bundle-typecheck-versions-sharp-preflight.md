---
"create-nexpress": patch
---

Bundle of four scaffold polish fixes uncovered while auditing the first-time UX path:

1. **Pre-flight no longer false-positives on re-run.** `runMigrations` now checks `drizzle.__drizzle_migrations` first — if drizzle has already migrated this DB, skip the "another project owns this DB" collision flag and let `drizzle-kit migrate` handle idempotency. Previously operators running `pnpm setup` a second time hit "DB already populated" with a "DROP DATABASE" recommendation that would have nuked their own data.

2. **`typecheck` script added** to scaffolded `package.json` — `pnpm run typecheck` now works without falling through to pnpm's built-in shadow.

3. **`@nexpress/*` deps pinned to `^0.1.3`** instead of `latest`. Explicit pin = the scaffold and its runtime always speak the same `@nexpress/*` major.minor family. A stale `create-nexpress` will no longer scaffold a project against a future breaking `@nexpress/core` whose API the scaffold templates haven't kept up with. Bumped manually when the family hits a new minor; operators can still `pnpm update --latest @nexpress/*` locally.

4. **`pnpm.onlyBuiltDependencies: ["sharp", "@node-rs/argon2"]`** added to scaffolded `package.json`. pnpm 10+ defaults to skipping native-build postinstalls — without explicit approval, media uploads (sharp) and password hashing (argon2) crash at runtime with opaque "module not found" errors. Allowlisting these two specifically (and only these two) gets them built on first install without operator intervention.
