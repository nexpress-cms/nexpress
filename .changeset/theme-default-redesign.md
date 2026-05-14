---
"@nexpress/theme-default": minor
---

Theme-default redesign — production blog baseline with seed content.

The visual surface is overhauled to a low-key engineering-blog identity:
hairline sticky header with a logo mark + centered nav + ⌘K search pill +
Subscribe CTA; centered page header with a primary-tinted eyebrow pill +
big headline + intro + category strip; two-column feature card with a
gradient cover (figure + issue/read-time overlay) above a three-up post
grid where each card cycles through six cover gradients and four avatar
tones so the grid reads as a typographic mosaic; dark inline newsletter
slab with a radial glow; four-column footer (brand / sitemap / resources
/ newsletter) with a bottom secondary-links row.

`impl.tokens` overlay sets the new identity — indigo `#4f46e5` primary,
Geist Sans + Geist Mono font stacks (system-font fallback chain so no
webfont request at boot), refreshed radii (6 / 10 / 14 px).

`impl.seedContent` ships out of the box:

- **11 tags**: Engineering, Postgres, TypeScript, Distributed, Product,
  Notes, RFC, Caches, Indexes, Types, Queues.
- **7 posts** (one feature + six grid): production-shaped pieces on
  read-replica routing, planner pathology, branded primitives, the
  transactional outbox, latency budgets, cache stampedes, and the
  RFC template.
- **Navigation**: header (Writing / Notes / Talks / About) and footer
  (same + Archive).

`PostCard` gains optional props (`coverGradient`, `coverFigure`,
`coverOverlay`, `kicker`, `avatarTone`) that the post-list template
supplies based on card index. `PostListDoc` (the doc shape the list
template reads) gains `eyebrow`, `categories`, `sectionMeta`,
`pagination`, `newsletter` — all optional, so existing sites that route
plain `{ docs, heading, intro }` through the template keep working.

Inline newsletter renders a plain `<form action="/api/subscribe">`
(operators wire the endpoint) rather than pulling the
`useState`-backed `NewsletterForm` into the server-template bundle.
Footer continues to render the client `NewsletterForm` for inline
success / error feedback.
