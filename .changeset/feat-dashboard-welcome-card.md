---
"@nexpress/admin": patch
---

**Dashboard onboarding: welcome card on fresh installs.**

When the dashboard loads with no content AND no recent activity
(brand-new install signal), the dashboard now shows a "Welcome
to NexPress" card listing four concrete next-step actions:

1. Create your first post
2. Tune site settings
3. Browse plugins
4. View your site (opens public site in a new tab)

The card disappears as soon as any content lands or any activity
gets recorded, so it doesn't stick around as visual noise once
the operator is rolling.

Also adds an empty-state message to the "Collection pulse" card
when no collections are registered (rare but possible during
plugin development / collection-config refactor).
