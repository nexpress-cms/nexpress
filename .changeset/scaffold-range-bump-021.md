---
"create-nexpress": patch
---

Bump `SCAFFOLDED_NEXPRESS_RANGE` from `^0.1.0` to `^0.2.0`. The `@nexpress/*` family crossed into 0.2.x with the single-source refactor (0.2.0 published, then 0.2.1 after the tsup build fix). The scaffold's pinned range never followed, so `npx create-nexpress` projects installed `@nexpress/admin@0.1.6` / `@nexpress/core@0.1.6` etc. — the previous minor's last patch, missing every refactor that went into 0.2.x. Operators saw scripts/lib/proxy/i18n/globals.css all silently regressed even though the npm `latest` tag was 0.2.1.

Pinning to `^0.2.0` lines the scaffold back up with the family's actual current minor. Note for future minor crossings: this constant has to be bumped manually in the same release that ships the minor; without it, scaffolded installs silently lag by exactly one minor.
