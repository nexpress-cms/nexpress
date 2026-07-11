---
"@nexpress/core": minor
"@nexpress/theme": minor
"@nexpress/next": patch
"@nexpress/cli": patch
---

Add a complete theme definition contract across module evaluation, config
resolution, core registration, Next bootstrap, and CLI installation. Theme
metadata, requirements, settings, routes, templates, tokens, translations,
blocks, patterns, member/SEO contributions, and seed content now fail early
with precise locations instead of being filtered or deferred until render.
