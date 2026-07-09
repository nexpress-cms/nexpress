---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/cli": patch
"@nexpress/core": patch
"@nexpress/plugin-sdk": patch
"@nexpress/plugin-analytics-lite": patch
"@nexpress/plugin-forum": patch
"@nexpress/plugin-seo-audit": patch
"@nexpress/plugin-webhook-relay": patch
---

Add typed definition-level plugin actions, validate declarative Admin action
ids and result kinds early, and surface missing, mismatched, duplicate,
setup-untyped, and Admin-unreferenced actions through plugin doctor.
