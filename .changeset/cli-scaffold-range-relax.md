---
"create-nexpress": patch
---

Relax the scaffold's `@nexpress/*` dependency pin from `^0.1.3` to `^0.1.0`. Same semantic effective range (`>= 0.1.0 < 0.2.0` covers the entire 0.1 minor family), but it no longer assumes a specific patch as the floor.

The previous `^0.1.3` pin broke `pnpm install` in any scaffolded project after `@nexpress/app@0.1.1` shipped: the new package was below the floor even though it's in the same family. With the fixed-versioning group in `.changeset/config.json` now covering every `@nexpress/*` (separate changeset on this same release), the family stays on a single `0.1.x` going forward — `^0.1.0` is the right floor for that policy.

Bump the pin again only when the family crosses a minor boundary (0.2.0, 1.0.0, …).
