---
"@nexpress/blocks": patch
"@nexpress/core": patch
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/cli": patch
"@nexpress/plugin-sdk": patch
---

Stabilize the exact block prop schema contract across author types, runtime validation, Admin controls, public discovery, OpenAPI, plugin doctor, and generated plugin scaffolds. The unfinished `media` alias is removed in favor of `image`, and `patternMessage` is replaced by the type-neutral `validationMessage`.
