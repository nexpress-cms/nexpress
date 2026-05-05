---
"@nexpress/theme": minor
"@nexpress/theme-default": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Thread the block render ctx from the site renderer into theme templates (#476).

PR #469 added server-rendered / data-bound blocks (`latest-posts`,
`stats.counter`, plugin-contributed dynamic blocks) that need an
`NpBlockRenderContext` to query content. Shipped theme templates
called `renderBlocks(blocks)` without passing the ctx, so those
blocks rendered the "ctx unavailable" placeholder instead of the
real query result.

`NpTemplateRenderProps` now carries an optional
`blockCtx?: NpBlockRenderContext`. The reference site renderer
builds one per page render via `createDefaultBlockRenderContext()`
and passes it into both the active theme template and the
historical fallback `renderBlocks` call. Each shipped template
forwards it as `renderBlocks(blocks, { ctx: blockCtx })`.

Theme packages no longer have to import `@nexpress/next` directly
to opt into the ctx — the type is exposed via `@nexpress/theme`'s
new `@nexpress/blocks` dependency. Templates that don't use
data-bound blocks can ignore the prop entirely; static themes
keep their pre-#476 call shape unchanged because `blockCtx` is
optional and `renderBlocks(blocks)` with `undefined` ctx still
works.
