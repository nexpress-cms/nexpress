---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/core": patch
---

Tighten scheduled publishing end to end: add an admin status filter for scheduled rows, include draft-enabled framework `publishedAt` columns in the scheduled sweep, return the sweep timestamp from the internal trigger, and document the public API scheduling contract.
