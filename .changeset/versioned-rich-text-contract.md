---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/blocks": patch
"@nexpress/core": patch
"@nexpress/editor": patch
"@nexpress/plugin-forum": patch
"@nexpress/plugin-reading-time": patch
"@nexpress/plugin-seo-audit": patch
"@nexpress/theme-default": patch
"@nexpress/theme-docs": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
"@nexpress/translation": patch
"@nexpress/wp-import": patch
---

Promote rich-text content to a stable NexPress-owned v1 envelope. Validate the
wire format before collection writes; share the type guard, validator, version,
and empty-document factory through the client-safe fields subpath; and align
editor state, generated types, SSR, search, media and mention extraction,
translation interchange, WordPress import, Admin, themes, and example plugins.
