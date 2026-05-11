---
"@nexpress/plugin-block-newsletter": patch
"@nexpress/plugin-forum": patch
---

**Fresh-build DTS race for self-import packages — fixes CI
Release / CI workflows failing on first push.**

When push-time CI triggers were restored in #640, both
workflows failed at the build step on
`@nexpress/plugin-block-newsletter`. Root cause: the package
imports its own `./client` subpath (so tsup keeps the
`"use client"` boundary visible to Next), and on a fresh build
(no cached dist), the dts step for the `index` entry tries to
resolve `@nexpress/plugin-block-newsletter/client` while the
**other entry's dts is still emitting** — `dist/subscribe-form.d.ts`
doesn't exist yet, the `exports` map can't resolve, build
fails with "Could not find a declaration file".

Locally this didn't surface because incremental builds had a
stale dist sitting in place from previous runs; the resolution
walk hit pre-existing files.

The same shape exists in `@nexpress/plugin-forum` (its
`routes/*.tsx` files self-import from
`@nexpress/plugin-forum/client`). Forum's build doesn't
currently fail because its two-entry array config happens to
finish the smaller `client` dts first by timing, but the
behavior is timing-dependent and would break under different
machine load.

Fix: ambient `*.d.ts` shim in each affected package that
pre-declares the self-import:

- `packages/plugins/block-newsletter/src/self-shim.d.ts`
- `packages/plugins/forum/src/self-shim.d.ts`

```ts
declare module "@nexpress/plugin-block-newsletter/client" {
  export { SubscribeForm } from "./subscribe-form.js";
}
```

The shim lets the dts resolver see the module's types without
crossing into the `exports` map → filesystem path. Runtime
imports still go through `exports` at consumer load time, so
the `"use client"` RSC boundary stays intact.

Verified: `pnpm build` (fresh, all dist removed) — 30/30 tasks
pass.
