---
"@nexpress/admin": minor
---

**First-time UX (items 1 + 2 of 5).**

1. **Collection list empty-state CTA.** `/admin/collections/<slug>` used to show "No documents found." for both "operator hasn't created any yet" and "no docs match the current filter". Truly-empty collections (no `search` / `status` filter active) now render a centered "Create your first <singular>" card with a primary action button. Filtered-empty collections keep the old behavior.

2. **Dashboard welcome card → 5-step checklist.** Replaces the single welcome message (#618) with a 5-step setup checklist that reads its state from new `DashboardStats.onboarding` flags:

   - ✓ Admin account created (always true if the page renders)
   - Name your site (`np_sites.name !== "Default site"`)
   - Publish your first post (`np_c_posts` count > 0 with `_status='published'`)
   - Pick a theme (`activeTheme !== "default"`)
   - Connect a production domain (`SITE_URL` is not localhost)

   The card hides only when every step is ✓, so the operator always has a single place that says what's left.
