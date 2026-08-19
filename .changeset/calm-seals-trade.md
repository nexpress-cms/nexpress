---
"@nexpress/core": patch
"@nexpress/oauth-providers": patch
---

Remove the deprecated Arctic runtime dependency. The bundled GitHub, Google,
and Discord factories now use provider-specific authorization-code flows with
S256 PKCE and bounded token-response validation, while the structural
`fromArctic` adapter remains available as a deprecated compatibility surface.
