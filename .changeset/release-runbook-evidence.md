---
"@nexpress/app": patch
"create-nexpress": patch
---

Preserve nested ops `plan.nextCommands` in release plans and executable
runbooks so migration rollback, backup restore, storage migration, and plugin
upgrade evidence keep their concrete follow-up commands in agent handoffs.
