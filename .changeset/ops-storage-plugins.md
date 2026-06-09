---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add read-only ops storage and plugin diagnostics.

Generated apps now include `ops:storage` and `ops:plugins` scripts. The
project CLI delegates `nexpress ops storage status`, `nexpress ops plugins
list`, and `nexpress ops plugins doctor` to those scripts so agents and
operators can inspect storage readiness, local media drift, plugin inventory,
and static plugin conflicts through stable JSON contracts.
