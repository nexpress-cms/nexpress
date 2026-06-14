---
"@nexpress/app": patch
"create-nexpress": patch
---

Bridge the first deploy path across generated projects and ops commands. The
deploy-plan JSON now includes an ordered deploy bridge, and scaffold success
output, generated README/ops docs, setup completion copy, and package README all
point operators through deploy plan, migration, preflight, release check, and
post-deploy verify.
