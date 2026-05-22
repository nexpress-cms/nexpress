---
"@nexpress/app": patch
"create-nexpress": patch
---

Let `pnpm run doctor:prod` accept `--target vercel|railway|render|fly|docker` so production readiness checks can enforce host-specific storage and worker requirements.
