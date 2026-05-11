---
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Use logical RTL-safe `padding-inline-start` instead of `padding-left` for mobile sub-nav lists in `theme-magazine` and `theme-portfolio`. The default theme already used logical properties; this brings the v0.2 reference themes into alignment so RTL locales render correctly.
