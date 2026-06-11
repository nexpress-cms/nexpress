---
"@nexpress/app": patch
"create-nexpress": patch
---

Expand the agent-operated ops execution loop.

`nexpress ops jobs retry-all` now dry-runs retryable archived jobs by default,
then requires `--execute --approve retry-all` before re-enqueuing failed,
cancelled, or expired jobs with a mutation audit block. `nexpress ops jobs
drain` now reports drain readiness by default, and `--execute --approve drain`
starts a safe drain by pausing new job claims while reporting remaining active,
created, and retry counts.

`nexpress ops storage verify` now exposes an explicit integrity gate, and
`nexpress ops storage test --execute --approve storage-test` runs an upload /
exists / delete probe through the configured local or S3 adapter. Fresh
scaffolds document the new commands in the generated README.
