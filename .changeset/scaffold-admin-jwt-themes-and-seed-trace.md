---
"@nexpress/app": patch
"create-nexpress": patch
---

Three more first-boot regressions surfaced during PR #717 verification:

1. **`/admin` → 500 with `JWSSignatureVerificationFailed`** when a stale `np-session` cookie (signed by a previous project's `NP_SECRET`) is still in the browser. The protected admin layout called `verifyTokenFull(...)` without a try/catch, so the JWS error bubbled all the way to the page response. Operators trying to recover from a re-scaffold against the same `localhost:3000` had no path back to `/admin/setup`. Wrap the verify in try/catch and treat any throw as "no valid session" — the existing branch then routes the visitor to `/admin/setup` (no admin yet) or `/admin/login`.

2. **Built-in themes not surfacing in admin → Appearance.** PR #717 added `@nexpress/theme-default / -docs / -magazine / -portfolio` as scaffold deps but `nexpress.config.ts` had no `themes:` array, so the registry stayed empty even though the packs were installed. Mirrors `apps/web/src/nexpress.config.ts` — emit the four imports + `themes: [...]` from `nexpressConfigTemplate`.

3. **Silent seed failures.** `seedAll` was best-effort wrapped in PR #717, but the warning only landed in the HTTP response — the operator typically never sees it (the wizard's success path immediately routes to `/admin`). Log the full thrown stack on the server console as well so a missing FK / failed collection-hook validation is visible in the dev terminal where the operator is already looking. Same for `updateSite`.
