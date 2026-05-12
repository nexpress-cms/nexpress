---
"@nexpress/core": patch
---

Remove `prepublishOnly: "pnpm build"` from every package. The script
ran each package's tsup (with `--clean`) in parallel during
`changeset publish`, so siblings' `dist/` got wiped mid-build and
the DTS step couldn't find sibling type declarations. The root
`pnpm release` already runs `pnpm build` upfront, so the
per-package safety net was redundant AND racy.
