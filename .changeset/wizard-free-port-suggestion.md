---
"@nexpress/app": patch
---

Setup wizard's "Test connection" now scans for a free TCP port near the failing one when it hits a port-collision auth error (sqlstate `28P01` / `28000`), and appends a concrete recommendation to the error message:

```
Detected free port: 5601. If you want to pick that, set:

  NEXPRESS_DB_PORT=5601
  DATABASE_URL=postgres://nexpress:<password>@localhost:5601/mysite

in .env …
```

Previously the operator only got the generic "pick a free port via `NEXPRESS_DB_PORT`" advice and had to find a free slot themselves. The scan starts one above the failing port and is bounded (100 ports max) so the wizard stays responsive; when every port in the range is taken the wizard falls back to the base message with no suggestion.

Internal split: the helpers live in a new `scripts/setup-server-ports.ts` sibling alongside the existing `setup-server-errors.ts` / `setup-server-validate.ts` modules. `messageForConnectionError` gained an optional `{ suggestedPort }` parameter (defaults to absent — the unit tests confirm pure behavior is unchanged).
