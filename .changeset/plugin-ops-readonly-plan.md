---
"@nexpress/app": patch
"create-nexpress": patch
---

Add read-only plugin ops inspection and upgrade planning.

Generated apps can now run `ops:plugins inspect <pluginId>` to inspect one
configured plugin and `ops:plugins upgrade-plan [pluginId]` to produce package
review, upgrade, rebuild, and verification steps without mutating dependencies or
configuration.
