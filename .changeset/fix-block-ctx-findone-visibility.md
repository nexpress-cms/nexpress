---
"@nexpress/next": patch
---

Fix `findOne` on the block render context bypassing anonymous-visibility and published-status filters (#475).

`createDefaultBlockRenderContext().content.findOne` was calling
`getDocumentById` directly, which only enforces tenant scoping and
the collection's `access.read({ user, doc })`. For collections
whose `access.read` returns `true` for unauthenticated users (the
reference `posts` collection is the canonical example), a draft
or `visibility = "private"` doc id reaching a block plugin —
plugin author input, query string, or persisted block prop —
would render the doc on a public page.

`findOne` now routes through `findDocuments(collection, { where:
{ id, ... applyPublishedDefault } })`. Going through that path
fires the pipeline's anonymous-visibility default
(`visibility = "public"` when no `user` is passed) and the
existing `applyPublishedDefault()` status guard, so:

- Drafts no longer leak through `findOne`.
- Private (`visibility = "private"`) rows no longer leak through
  `findOne`.
- Per-collection `access.read` semantics are unchanged — block
  plugins keep the same surface they had before.

Added a unit test pinning the wire shape of the `findDocuments`
call so future refactors can't silently skip the filters.
