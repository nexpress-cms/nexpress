---
"@nexpress/admin": patch
"@nexpress/app": patch
---

fix(admin, app): editor track audit follow-ups — reduced-motion, container-nested hidden detection, main-column empty state

Three small follow-ups from a post-track audit of the editor
progressive-disclosure work (#756–#773):

- **`prefers-reduced-motion: reduce`** on the sidebar group
  collapse animation. PR #760 added the 180ms slide on
  `.np-sidebar-group-content` but didn't include the
  reduced-motion override — vestibular-sensitive users with
  the OS preference set still saw the animation. Adds an
  `@media` block that disables the keyframes when the
  preference is set.
- **`hasHiddenFields` recurses into containers**. The check
  that decides whether the "Show all fields" toggle is even
  rendered skipped `row` / `collapsible` containers, so a
  conditional field nested inside one wouldn't trip the
  toggle even though PR #772 (container-nested condition)
  would gate it out of the form. Replaced with a call to
  `collectHiddenFieldNames` (single source of truth — same
  helper the server pipeline + zod resolver use).
- **Main-column empty state**. PR #765 added the "every
  sidebar field hidden" Card; PR #766 added main-column
  group symmetry. The pair left a hole: if every main field
  gets hidden by the active kind, the left column went
  blank with no reason or escape hatch. Mirrors the sidebar's
  empty-state Card with a "Show all fields" link.
