---
"@nexpress/app": patch
"create-nexpress": patch
---

Harden release apply execution again. Approved release apply commands now run
through structured executable/argv specs instead of shell command strings, and
release plan artifact loading verifies required top-level fields before the
apply pipeline starts.
