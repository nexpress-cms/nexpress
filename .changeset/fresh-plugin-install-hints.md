---
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/plugin-sdk": patch
---

Improve plugin authoring/install UX in the admin registry. The discover API now returns install,
registration, and verification hints for each npm result, and the admin Browse registry dialog can
copy both the install command and the matching `nexpress.config.ts` registration snippet. Plugin
author docs now reflect the current auto-form `.refine()` support and plugin object registration
shape.
