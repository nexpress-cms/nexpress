---
"@nexpress/app": patch
"create-nexpress": patch
---

Add read-only backup restore planning.

Generated apps can now run `ops:backup restore-plan [latest|manifestId]` to
produce an isolated restore drill plan with artifact checks, ordered restore /
verify / record steps, and approval flags. `ops:backup verify` can also target a
specific manifest id instead of only `latest`.
