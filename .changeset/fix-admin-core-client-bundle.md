---
"@nexpress/core": patch
"@nexpress/admin": patch
---

fix(core, admin): admin client bundle no longer drags argon2 / pg

`@nexpress/admin`'s `collection-edit-view` (a `"use client"`
component) imported `collectHiddenFieldNames` and
`evaluateFieldCondition` from the `@nexpress/core` root. The
root re-exports `@nexpress/core/auth`, which transitively pulls
`@node-rs/argon2` and `pg` into the bundle — Next's client
bundler tried to resolve `argon2/browser.js`'s `verify` export
and failed, killing every CI build since #756 landed:

```
The export verify was not found in module @node-rs/argon2/browser.js
```

Adds a new client-safe subpath `@nexpress/core/fields` that
re-exports only the pure helpers (`evaluateFieldCondition`,
`collectHiddenFieldNames`, `buildZodSchema`,
`getCollectionZodSchema`). No transitive auth / db / sharp /
argon2 imports — verified by grepping the produced
`dist/chunk-*.js` files that the new entry pulls in.

The admin's runtime import switches to `@nexpress/core/fields`;
the type-only `import type { NpCollectionConfig, NpFieldConfig }`
stays on the root (type imports are erased and don't drag
runtime code).

Bump kind: patch. Adding a new export is arguably minor by
strict semver, but pre-1.0 we default to patch unless the user
explicitly approves otherwise.
