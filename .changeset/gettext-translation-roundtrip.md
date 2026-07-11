---
"@nexpress/gettext": patch
"@nexpress/translation": patch
"@nexpress/xliff": patch
"create-nexpress": patch
---

Add Gettext PO content translation round-trips and move XLIFF onto the same
format-neutral extraction and fail-closed application engine. Atomic strings,
Lexical text, and schema-declared nested block props now share live source and
routing validation across both interchange formats. Fresh scaffolds include
ready-to-run `pnpm gettext` and `pnpm xliff` shims.
