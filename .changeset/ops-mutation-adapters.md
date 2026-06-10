---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add initial ops mutation adapters.

`nexpress ops backup create` now records an operator-provided backup manifest,
and `nexpress ops jobs pause|resume` now persists the global jobs pause state
with mutation audit details in the `np.ops-jobs.v1` report.
