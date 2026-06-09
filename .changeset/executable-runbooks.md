---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add read-only executable runbooks.

Generated apps now include a `runbook` script. `nexpress runbook <name>` emits
`schemaVersion: "np.runbook.v1"` with evidence, diagnosis, risk, next commands,
rollback notes, and docs links for worker drain, storage migration, backup drill,
and migration-crash incident paths.
