---
"@nexpress/app": patch
"@nexpress/auth-pages": patch
"@nexpress/core": patch
"@nexpress/plugin-oauth-github": patch
"@nexpress/plugin-oauth-google": patch
---

Harden OAuth onboarding: doctor now reports partial bundled-provider env pairs, OAuth login surfaces honor provider audiences, member login can expose supported providers, and bundled OAuth plugins stay quiet until configured.
