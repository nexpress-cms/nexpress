---
"@nexpress/app": patch
"create-nexpress": patch
---

Add read-only migration rollback planning.

Generated apps can now run `ops:migrate rollback-plan --json` to produce a
backup-restore rollback checklist for pending or risky migrations. The plan
includes inspect, backup, restore-plan, rollback, and verification steps with
approval flags, while destructive migration apply remains future work.
