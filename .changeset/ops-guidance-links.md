---
"@nexpress/app": patch
---

Tighten agent-operated ops guidance.

Jobs reports now point paused queues at `nexpress ops jobs resume`, failed /
expired queues at the bounded `retry-all` dry-run, and retry backlogs at the
safe drain dry-run. Storage reports now point warning states at `verify` and
then at the approval-gated probe dry-run. The low-token `ops status`, release
plans, and executable runbooks promote these actionable commands so agents can
choose the next safe step without falling back to generic doctor output.
