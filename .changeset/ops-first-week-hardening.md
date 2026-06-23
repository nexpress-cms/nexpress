---
"@nexpress/app": patch
---

Harden first-week operations output by fixing `ops:storage migrate plan` parsing behind
pnpm passthrough arguments and surfacing per-step preflight and backup action notes in
brief reports.
