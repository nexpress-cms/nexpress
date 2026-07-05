---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/plugin-sdk": patch
---

Align media hook actor payloads with content hooks: staff and member uploads now expose a polymorphic `principal`, member uploads emit `media:beforeUpload`, and plugin hook context types accept `user: null` for member-authored operations.
