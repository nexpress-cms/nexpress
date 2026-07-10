---
"@nexpress/app": patch
"@nexpress/cli": patch
"@nexpress/core": patch
"@nexpress/plugin-analytics-lite": patch
"@nexpress/plugin-sdk": patch
"@nexpress/theme-docs": patch
---

Replace the unused `render:afterPage` hook with one typed `render:beforePage`
contribution contract, require function-based hook handlers, reject invalid
hook registrations and render results, and restore the Analytics Lite
body-end collector on public pages.
