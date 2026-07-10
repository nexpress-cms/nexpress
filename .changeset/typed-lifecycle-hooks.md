---
"@nexpress/app": minor
"@nexpress/cli": patch
"@nexpress/core": minor
"@nexpress/plugin-reading-time": patch
"@nexpress/plugin-sdk": minor
"@nexpress/plugin-seo-audit": patch
"@nexpress/plugin-webhook-relay": patch
"@nexpress/theme-docs": patch
---

Give every content, auth, media, and render hook one exact typed data contract.
Normalize content lifecycle payloads around document state, source, and
principal; normalize media upload results; reject malformed dispatch data and
unknown hook names at the core boundary; and diagnose values returned from
fire-and-forget lifecycle handlers.
