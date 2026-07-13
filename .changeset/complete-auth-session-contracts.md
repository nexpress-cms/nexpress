---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/auth-pages": patch
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/theme-default": patch
"@nexpress/wp-import": patch
---

Unify staff and member authentication around exact identity, JWT, API wire, credential, runtime configuration, and one-row browser-session contracts. Runtime authentication now recognizes `NP_SECRET` as its only signing-key environment variable and fails closed for malformed JWT, lockout, invitation, reset, verification, or OAuth-state settings. Refresh compare-and-swap rotates access and refresh hashes, logout revokes the pair through either live token's shared session id, password replacement and whole-identity revocation commit atomically, single-use credentials reject concurrent replay, OAuth state cookies share the signed token lifetime, and doctor validates runtime configuration plus persisted auth/session rows.
