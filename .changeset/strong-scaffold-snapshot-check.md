---
"create-nexpress": patch
---

Strengthen scaffold snapshot drift detection. The snapshot sync logic now lives
behind one reusable module shared by the local check command, unit tests, and
CI, so changes to `apps/web/src` fail earlier when the generated scaffold
snapshot has not been refreshed.
