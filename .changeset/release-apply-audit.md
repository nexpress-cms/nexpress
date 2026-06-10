---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add approval-gated release apply audit artifacts.

`nexpress release apply --plan <artifact>` now validates a release plan and
writes a stable `np.release-apply.v1` audit artifact. It dry-runs by default,
and command execution requires both `--execute` and `--approve <planId>`.
