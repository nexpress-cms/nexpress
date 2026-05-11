---
"@nexpress/web": patch
---

**Enable npm publish via Trusted Publishing (OIDC) + restore
push-time CI triggers.**

Activates the dormant publish pipeline in
`.github/workflows/release.yml` (deferred since #393). Uses
npm's **Trusted Publishing** model — no `NPM_TOKEN` secret;
auth flows through GitHub's OIDC.

Three workflow changes:

1. **`release.yml`** — `push: main` trigger uncommented;
   `publish: pnpm release` re-added to the changesets/action
   step; `NPM_CONFIG_PROVENANCE: "true"` env passed; the
   workflow's existing `id-token: write` permission powers
   both provenance signing and TP auth.

2. **`ci.yml`** — `push: main` + `pull_request` triggers
   uncommented. Without push-time CI, a broken `main` could
   propagate to npm before anyone caught it.

3. **`docs/releasing.md`** — rewritten:
   - "Required secrets" → "Auth: Trusted Publishing (OIDC)"
   - Step-by-step TP setup per package on npmjs.com
   - Two paths for first publish (manual local with 2FA,
     OR one-shot classic token then revoke)
   - Post-publish verification (npm view, scaffold smoke,
     attestation check)

### Why TP, not NPM_TOKEN

npm's 2024 UX explicitly steers automation away from classic
Automation tokens: creating one shows "There are security
risks with this option. For automation or CI/CD uses, please
use Trusted Publishing instead." TP avoids:

- a long-lived secret in repo settings (leak / rotation risk)
- the 2FA-bypass checkbox warning
- per-token scope ambiguity

The trade-off: TP requires the package to exist on npm before
TP can be configured. For first-time publishes, operator
either publishes once locally with 2FA OR uses a one-shot
classic token that gets revoked right after.

### Safe-by-default flow

Changesets/action only publishes when no changesets remain
queued:

1. **Merge this PR** → next push to main has 138 queued
   changesets → workflow opens "Version Packages" PR.
   **No publish attempt.**
2. **Operator configures Trusted Publishers** on npmjs.com
   for each package (or completes first publish via either
   path above).
3. **Operator reviews + merges Version Packages PR** → next
   push has zero queued changesets → workflow runs `pnpm
   release` → tarballs published with Sigstore provenance via
   OIDC auth.

Operator can skip steps 2 between merging this PR and the
Version PR — the first publish run from CI will fail with an
auth error pointing at missing TP config. Easy to recover:
add TP configs, push an empty commit (or re-run the workflow),
publish completes.
