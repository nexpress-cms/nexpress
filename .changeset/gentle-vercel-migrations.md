---
"@nexpress/app": patch
"create-nexpress": patch
---

Clarify the Vercel migration path in deploy plans and scaffolded ops docs. The
guidance now calls out that sensitive Vercel env values are not a reliable
local migration source, and points operators toward CI, the Vercel build
command, or another trusted shell where production `DATABASE_URL` is already
injected.
