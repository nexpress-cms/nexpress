---
"@nexpress/core": patch
---

Fix cross-site reaction deletes (#362).

`addReaction` rejected cross-site targets, but `removeReaction` still
deleted by `targetType` / `targetId` / `memberId` / `kind` only — a
member acting on site A could name a site B comment UUID and remove
their site B reaction, also applying the reputation reversal in the
wrong site context.

`removeReaction` now resolves the request's site, looks up the target
comment's `siteId`, throws `NxForbiddenError("reaction", "cross-site")`
when they diverge, and includes `siteId` in the delete predicate as
defence-in-depth (the row only deletes when both identifiers agree).
