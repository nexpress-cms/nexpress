---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add release plan audit artifacts.

`nexpress release plan --target <host>` now runs the pre-release gate and writes
a stable `np.release-plan.v1` artifact under `.nexpress/releases/` by default,
including remediation, release, and verify commands plus apply preconditions.
