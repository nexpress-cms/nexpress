---
"@nexpress/app": patch
"create-nexpress": patch
---

Add read-only storage drift and migration planning commands.

`nexpress ops storage missing-files --json` and `orphaned-files --json` now
return concrete local media drift lists. `nexpress ops storage migrate plan
--target s3 --json` produces a read-only local-to-S3 migration plan with
inspect, prepare, and approval-gated future apply commands. The
`storage-local-to-s3` runbook now collects the new drift and migration-plan
evidence, and freshly scaffolded READMEs list the new commands.
