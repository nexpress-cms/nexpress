---
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/app": patch
"@nexpress/admin": patch
"@nexpress/translation": patch
"@nexpress/wp-import": patch
"create-nexpress": patch
---

Unify collection storage, runtime, generated, Admin, REST, OpenAPI, and
import/export document shapes behind an exact definition-derived contract.
Collection reads now hydrate ordered child and hasMany rows, updates preserve
omitted fields, `_status` is request-only, and malformed persistence or hook
results fail closed with doctor and live-health diagnostics. Collection
lifecycle after-hooks now run exactly once with the same hydrated document
contract as plugin lifecycle hooks.
