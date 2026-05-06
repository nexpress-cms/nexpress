---
"@nexpress/blocks": minor
---

Five new built-in blocks so a real landing page can be composed
without falling back to a single rich-text dump:

- `section-header` — eyebrow + heading + subtitle. Drop above any
  content section that needs a labeled intro.
- `testimonials` — quote-card grid (avatar / name / role / rating).
  Auto-collapses to one column on mobile and caps at three on
  desktop.
- `stats-grid` — number + label cells in a horizontal strip. The
  value is a string field, so suffixes like `"99.9%"` / `"10k+"` /
  `"$2.4M"` work without a parse step.
- `logos-cloud` — grayscale logo strip for trust signals. Each
  logo can be a link or an inert mark.
- `tabs` — exclusive-accordion via HTML5's `<details name="...">`
  group. Browsers that honor the spec render it as native tabs
  (one panel open at a time); browsers that don't fall back to
  plain accordion. SSR-pure, no client JS.

All five register through the shared block registry alongside the
existing built-ins, so plugin / theme / admin consumers pick them
up automatically without explicit wiring.
