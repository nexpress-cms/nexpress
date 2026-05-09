---
"@nexpress/theme-portfolio": minor
---

**Phase F.9-C — portfolio theme rebuilt against v0.2 contract.**

Third of three reference-theme rebuilds (design doc §4.9).
Stresses **F.3 deep settings** as the primary axis — the 10-
field settingsSchema exercises every auto-form widget the
generator supports (number range, enum, boolean, color regex,
URL, text, textarea, array of objects with required sub-fields).

Combined with magazine (F.9-A) and docs (F.9-B), v0.2's
contract surfaces are exercised end-to-end by 3 themes that
look and behave very differently — a real test of "any
content-centric site shape" claim.

### v0.2 surfaces (per phase)

| Phase | Surface |
|---|---|
| F.1 | \`requires\`: posts collection with \`heroImage\` (upload), optional \`client\`/\`year\`/\`role\` (text/number, hard:false) |
| F.3 | **10-field settingsSchema** — gridColumns (number range), cardAspect (enum), hoverStyle (enum), galleryGutter (number range), showProjectMeta (boolean), showProjectTags (boolean), accentColor (color regex), studioName (text), aboutCopy (textarea), showFooterCredit (boolean), copyrightYear (optional number), clientLogos (array of objects with required URL sub-fields) |
| F.4 | 2 blocks: \`portfolio.case-study-hero\` + \`portfolio.image-grid\` |
| F.6 | 2 navLocations: \`primary\` + \`footerSocial\` |
| F.7 | \`notFound\`: dark/sparse 404 styled to surface palette |

### Cross-axis check vs F.9-A / F.9-B

| Axis | magazine | docs | portfolio |
|---|---|---|---|
| Settings shape | enum/array-heavy | text-heavy (5 fields) | every widget type (10 fields) |
| Patterns | yes (2) | no | no |
| Archives | yes (byCategory + byAuthor) | no (uses routes) | no |
| Routes | no | yes (/search) | no |
| navLocations | 3 | 1 | 2 |
| Blocks | 2 | 0 | 2 |

Combined coverage: every contract surface exercised by at least
one theme, the auto-form generator validated against every
widget type, both archives + routes paths through F.2, F.4 +
F.5 patterns covered.

### What's not in this PR (F.9.1 follow-up)

- **Theme components reading getThemeSettings**: the 10-field
  schema exists and validates, but the existing portfolio
  components still render with hardcoded defaults. Wiring 
  `settings.gridColumns` / `settings.hoverStyle` etc. through
  to the actual rendering is operator-facing polish; the
  contract is shipped.
- **Image-grid array editor**: \`items\` field uses textarea/JSON
  in v0.2 (same as magazine.section-strip). F.5.1 adds a richer
  per-item editor.

### Validation status

Third and final reference-theme rebuild. F.9-D will retire
\`default\` + \`minimal\` (absorbed as magazine settings
variants per design doc §1 decision C).

The portfolio theme stays registered in apps/web's
nexpressConfig.themes alongside magazine, docs, default,
minimal — operators can compare side-by-side via admin's
theme switcher.

### Dependency note

\`@nexpress/theme-portfolio\` gains \`zod\` (^4.3.6) for the
settings schema.
