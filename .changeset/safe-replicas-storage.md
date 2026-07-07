---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
---

Treat `NP_REPLICAS>1` as a production multi-node signal in boot safety,
doctor, and admin readiness checks so local storage and in-memory rate-limit
risks are surfaced consistently before deploy.
