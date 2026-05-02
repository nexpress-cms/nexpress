---
"@nexpress/core": patch
---

Scope `resolveReport` to the current site (#363).

`listReports` was already site-scoped, but `resolveReport` fetched
and updated by report id only. A moderator who obtained a foreign
report id could mark it resolved and write the audit event in the
wrong site context.

`resolveReport` now requires the request site, throws
`NxForbiddenError("report", "cross-site")` when the loaded row's
`siteId` diverges, and pins `siteId` in the update predicate so the
read-check and the write cannot drift.

`NxReportRow` gains the `siteId` field that the schema has had since
Phase 18.
