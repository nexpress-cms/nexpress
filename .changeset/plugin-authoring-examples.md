---
"@nexpress/plugin-sdk": patch
"@nexpress/core": patch
"@nexpress/plugin-analytics-lite": minor
"@nexpress/plugin-webhook-relay": minor
---

Add bundled analytics-lite and webhook-relay plugin examples, and derive admin,
page-route, and scheduled-task capabilities from `definePlugin()` declarations.
Also derive page-route and scheduled-task catalog metadata and add typed admin
action result helpers. Add plugin storage append/listValues helpers for
event-log style plugin data.
