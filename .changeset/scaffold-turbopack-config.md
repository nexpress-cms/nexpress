---
"create-nexpress": patch
---

Drop the `webpack` callback from the scaffold's `next.config.ts`. Next 16 made Turbopack the default bundler; mixing a `webpack` callback with no Turbopack config trips

```
Error: this build is using turbopack, with a webpack config and no turbopack config
```

and stops `pnpm dev` immediately after `pnpm setup`. apps/web had already been migrated (the inline comment there explains the same), but the scaffold template lagged behind and re-emitted the old callback into every newly scaffolded project.

The callback only pushed `@node-rs/argon2`, `pg-native`, and `sharp` into `externals`. `serverExternalPackages` covers the same surface for both bundlers, so the fix is to delete the callback and add `pg-native` to `serverExternalPackages`.
