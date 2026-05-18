---
"@nexpress/core": patch
---

Drizzle schema generator now honors `field.defaultValue` on `date` fields (previously dropped silently — only scalar text / number / checkbox fields were respected). Accepted shapes:

- `"now"` sentinel → emits `.defaultNow()` (compiles to `DEFAULT now()` at migration time).
- `Date` instance → emits `.default(new Date("<iso>"))`.
- ISO 8601 string → parsed and emitted the same as a Date.

Anything else is dropped (same defensive shape as the existing scalar fallbacks). Lets a theme / operator add a NOT NULL date column to a populated table in a single ALTER without a manual backfill — `defaultValue: "now"` paired with `required: true` is the common case.

No imports change in the generated schema file; `new Date(...)` is plain JS and Drizzle converts to SQL at query-build time.
