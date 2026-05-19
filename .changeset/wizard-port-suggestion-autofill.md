---
"@nexpress/app": patch
---

Setup wizard's "Test connection" now auto-fills the dbPort field (or splices `DATABASE_URL`'s port in URL mode) when the test fails on a port-collision auth error (sqlstate `28P01` / `28000`) and the server's free-port scan returned a usable alternative.

Operator flow before:

```
1. Hit "Test connection" → fails with 28P01
2. Read message: "Detected free port: 5601. Set NEXPRESS_DB_PORT=5601..."
3. Copy 5601, paste into the dbPort field
4. Hit "Test connection" again
```

After:

```
1. Hit "Test connection" → fails with 28P01
2. Form auto-fills 5601 in dbPort (or splices the URL string)
3. Hit "Test connection" again — no retyping
```

The auto-fill is a UI-side enhancement on top of the suggestion exposed by `testDbConnection`. The server-side endpoint (`POST /test-db`) now includes `suggestedPort: <number>` in the JSON response alongside `ok` + `message` when the scan found a free port; the form's JS reads it and applies it to whichever input mode is active (fields vs. raw URL). When no suggestion came back (any non-collision failure, or every port in the scan range was taken), the form keeps the existing message-only behavior.
