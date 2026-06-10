---
"@nexpress/app": patch
"@nexpress/cli": patch
"create-nexpress": patch
---

Add read-only migration and backup readiness checks for agent-operated release gates.

Projects now get `ops:migrate` and `ops:backup` scripts, exposed through
`nexpress ops migrate status|plan` and `nexpress ops backup status|list|verify
latest`. `release check` includes migration safety and required backup
readiness evidence, while migration and backup runbooks use the dedicated checks.
