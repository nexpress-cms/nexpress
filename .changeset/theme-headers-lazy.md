---
"@nexpress/theme-default": patch
"@nexpress/theme-magazine": patch
---

Lazy-import `next/headers` inside the request-scoped function body of `DefaultHeader` and `MagazineHeader` instead of at module top level. Next's `package.json` exports map declares `./headers` as a Next-build-context-only specifier — outside a Next bundle (e.g. when `pnpm nexpress theme:install <pkg>` dynamically imports a theme to read its `requires` field) the resolution fails with `ERR_MODULE_NOT_FOUND` at module load and the CLI can't read anything from the theme.

Moving the import into the function body keeps the theme module's top-level evaluation Next-free, so CLI tooling can introspect themes without booting a Next bundle. The request-scoped behavior is identical — `headers()` only executes inside a Next render anyway.
