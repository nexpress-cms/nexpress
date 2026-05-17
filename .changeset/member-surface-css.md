---
"@nexpress/theme-default": patch
"@nexpress/theme-portfolio": patch
"@nexpress/theme-docs": patch
---

Member-surface CSS pass — second sweep through PR #801's lint baseline:

- **Default theme** — adds CSS for the `MemberStatusWidget` (sign-in / sign-out chrome). 5 selectors: `.np-member-status` flex container, `.np-member-status-handle` link, `.np-member-status-loading` pulse skeleton, `.np-button-primary` filled CTA, `.np-text-button` minimal text button. The button classes are also reusable outside the widget.
- **Portfolio + docs themes** — adds CSS for the members shell + column (`np-portfolio-members` / `np-docs-members` outer container with vertical breathing room, `np-{portfolio,docs}-members-column` narrow auth-form column, max-width 30–32rem).
- **Lint baseline** — drops 8 fixed entries (5 default + 2 portfolio + 2 docs). Reclassifies 8 inline-styled landmarks (`np-{portfolio,docs}-{error,not-found,members-error,members-not-found}`) as VERIFIED_LANDMARK_INLINE — each renders its root with a full `style={{...}}` prop, so no CSS rule is needed. Strips JSDoc / line comments before token extraction so `<main className="np-member-main">` references in docstrings stop counting as JSX (drops `np-member-main` from both portfolio + docs baselines).
