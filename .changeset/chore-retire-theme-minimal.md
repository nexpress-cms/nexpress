---
"@nexpress/web": patch
---

chore(themes): retire `@nexpress/theme-minimal`

The 99-LOC v0.1-era demo theme (single file, centered logo + dotted border + serif body) is removed. Its self-described purpose ("Demo theme that proves the 11.x slot system swaps the rendered shell") is satisfied by the F-track + M-track adoption story across `theme-magazine` / `theme-docs` / `theme-portfolio`. The slot-system swap behavior is proven everywhere now — keeping a separate demo package is dead weight on the workspace.

Aligns with the original retirement plan in `docs/design/theme-v0.2-extension.md` § 1 / § 5 ("`default` and `minimal` retire — absorbed as `theme-magazine` settings variants"). Implementation simplified the plan to a clean delete; `theme-default` stays as the v0.1 fallback (it's the framework's "production-grade baseline" per its own JSDoc, not just a demo).

Files touched:
- `packages/themes/minimal/` — directory deleted
- `apps/web/src/nexpress.config.ts` — drop `minimalTheme` import + entry from `themes` array (now `[defaultTheme, magazineTheme, portfolioTheme, docsTheme]`)
- `apps/web/package.json` — drop `@nexpress/theme-minimal` workspace dep
- `apps/web/next.config.ts` — drop from `transpilePackages`
- `docs/theme-authoring.md` — update §11 reference table (drop minimal row, expand `theme-default` description), update `defineConfig` example to use `magazineTheme` instead of `minimalTheme`
- `CLAUDE.md` — refresh "Last refreshed" header note

Operators on the `minimal` theme have two upgrade paths:
1. **`theme-default`** — same v0.1 contract baseline, more feature-complete (header / footer / templates).
2. **`theme-magazine`** — full v0.2 + M-track adoption with the operator-no-code surfaces (settingsSchema, archives, patterns, member-shell, etc.).

`theme-minimal` was not a published v0.1 contract surface (per `AGENTS.md` STABILITY section); deletion is not a STABILITY-promised break.

Verified
- `pnpm typecheck` — 56/56 ✓ (was 58, -2 from minimal package's typecheck + build tasks)
- `pnpm build` — 30/30 ✓ (was 31)
- `pnpm install` clean

Closes "theme-simple consolidation" deferred entry in memory.
