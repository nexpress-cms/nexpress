---
"@nexpress/core": patch
---

fix(core): pipeline applies `defaultValue` before Zod validation

Integration tests started failing across every `saveDocument`
call after universal-content-model #748 added a required
`posts.kind` field with `defaultValue: "article"`. Callers that
omit the field (the canonical "minimal create" path) hit:

```
ZodError: { code: 'invalid_value', values: ['article'],
  path: ['kind'], message: 'Invalid input: expected "article"' }
```

`buildZodSchema` was building the field schemas without chaining
`.default(field.defaultValue)`. The Drizzle column default runs
at INSERT time, but the pipeline parses with Zod first, so the
"missing required field" hit before the DB could fill it.

Fix: `applyFieldDefault` chains `.default(field.defaultValue)`
onto the schema when the field declares one. Callers that DO
provide a value get their input through unchanged; callers that
omit get the default substituted before validation. Operator-
authored configs with `defaultValue` now actually work for the
zero-input case the docs imply they should.

Local: core 462/462 unit + 46/46 integration pass against the
test Postgres instance.
