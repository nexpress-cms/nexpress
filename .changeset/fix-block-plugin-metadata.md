---
"@nexpress/plugin-block-callout": patch
"@nexpress/plugin-block-embed": patch
"@nexpress/plugin-block-latest-posts": patch
"@nexpress/plugin-block-newsletter": patch
"@nexpress/plugin-block-pricing": patch
"@nexpress/plugin-block-stats": patch
---

Add missing `homepage` / `repository` / `bugs` metadata to the six block-plugin packages. Sigstore provenance validation rejects publishes whose `repository.url` doesn't match the OIDC token's source repo, so the CI publish was returning E422 ("repository.url is empty") for these packages even though the OIDC TP auth itself worked. Adding the standard metadata block (matching every other published `@nexpress/*` package) makes provenance validation pass.
