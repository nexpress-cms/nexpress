---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add a local ops contract registry. Generated projects now include `ops:contracts`,
which reports shipped ops/release/runbook JSON contracts, artifact behavior,
approval requirements, and explicitly deferred destructive surfaces. The
project-side `nexpress ops` CLI now delegates the shipped local ops commands
covered by that registry, while the agent-operated ops docs mark the v0.x local
CLI track complete and record the remaining remote/destructive work as
deferred.
