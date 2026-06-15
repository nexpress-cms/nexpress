---
"@nexpress/app": patch
---

Harden runbook artifacts. Runbook evidence now records command exit codes,
treats non-zero evidence command exits as blocked even when partial JSON was
printed, and keeps the runbook artifact writable for failed evidence commands.
