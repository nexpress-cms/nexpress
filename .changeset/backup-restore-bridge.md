---
"@nexpress/app": patch
"create-nexpress": patch
---

Strengthen the backup and restore bridge. Backup reports now expose
record/verify/restore handoff actions plus `plan.nextCommands`, restore drill
plans preserve project-local follow-up commands, and generated ops docs explain
the safer backup evidence path before release promotion.
