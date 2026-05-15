---
"@nexpress/app": patch
---

feat(app): SEO field maxLength hints + descriptions (12/14)

PR 12 of the editor progressive-disclosure sequence. PR 3
(#758) introduced the SEO meta fields without length limits;
operators authoring blind risked getting truncated previews in
search results.

- `seoMetaTitle`: `maxLength: 64` (~60-char Google snippet
  truncation, 4-char buffer). Description points operators at
  the soft limit.
- `seoMetaDescription`: `maxLength: 160` (~155-char
  description truncation). Description points at the same.

The hard `maxLength` is a tactile signal — the input rejects
further keystrokes before the operator hits the truncation
threshold. Soft / suggestion-only would be friendlier in
principle but harder limits prevent the mistake.

## Test plan

- [x] `@nexpress/app` build + typecheck clean
- [ ] Browser: SEO fields show the new descriptions; typing
  past the limit is blocked
