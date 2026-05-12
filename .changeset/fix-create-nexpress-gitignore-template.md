---
"create-nexpress": patch
---

Fix `npx create-nexpress` failing with "template not found: config/.gitignore". npm publish strips dot-prefixed files from the tarball as a default safety measure (so a published package can't ship a `.gitignore` or `.npmrc`), and the on-disk template was named `.gitignore` — so it disappeared from `create-nexpress@0.1.1` even though it existed in `dist/` locally. Renamed the template to `gitignore` (no dot) and updated the loader; the scaffolded project still receives `.gitignore` as the output filename.
