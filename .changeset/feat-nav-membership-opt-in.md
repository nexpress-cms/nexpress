---
"@nexpress/core": minor
"@nexpress/admin": minor
---

Generalize the page edit view's "In navigation" panel: it now renders
for any collection that opts in via `admin.navMembership: true` on
its `defineCollection()` config, not only the hardcoded `pages`
slug. The reference `pages` collection ships with the flag on, so
existing sites see no change. Sites with a `static-pages` or
`landing-pages` collection can flip the same flag on and the panel
will read/write the same `nx_navigation` rows.

The panel also gains a success flash after add/remove so the
operator gets explicit feedback (the silent membership reload was
hard to read against a long page form). The flash auto-dismisses
after 2.5s and stays out of the error region.
