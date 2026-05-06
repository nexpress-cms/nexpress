---
"@nexpress/admin": patch
"@nexpress/blocks": patch
---

Page-builder responsive grid spans (#467 #9): grid children carry `_layout: { colSpan, mdColSpan?, lgColSpan? }`. The base `colSpan` applies to mobile; `mdColSpan` overrides at ≥ 768 px, `lgColSpan` at ≥ 1024 px, and unset breakpoints fall back through the cascade (lg → md → base) via CSS custom properties + a scoped media query block. The form-editor's grid-child control swaps to a three-up Mobile / Tablet / Desktop picker with an "Auto" option for the larger breakpoints. Existing pages with only `colSpan` keep rendering identically.
