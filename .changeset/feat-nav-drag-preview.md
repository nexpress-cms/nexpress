---
"@nexpress/admin": minor
---

Nav editor's drag interaction now shows live intent during the
drag, not just after release. The over row picks up:

- A subtle primary ring while you're dropping at sibling depth
  ("will-reorder").
- A primary-tinted left border + ring once `delta.x` crosses the
  nest threshold ("will-nest"), matching the indent the new child
  would take so the cue is anchored to where the row will land.

The intent calculation lives in `handleDragOver` and mirrors
`handleDragEnd`'s rules exactly — same `wantsNest` check, same
1-level guards — so the preview can never disagree with the apply
path.
