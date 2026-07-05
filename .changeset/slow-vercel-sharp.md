---
"@nexpress/app": patch
"create-nexpress": patch
---

Harden Vercel standalone deploys for pnpm installs. `createNextConfig()`
now traces sharp and the Linux `@img/sharp-*` native packages through
pnpm's real `.pnpm/` store paths so Vercel functions include libvips at
runtime, while generated projects declare `sharp` directly to keep the media
runtime dependency explicit in production installs.
