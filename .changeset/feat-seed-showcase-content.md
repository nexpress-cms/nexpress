---
"@nexpress/web": minor
---

PR C of 3 in the "make defaults look properly designed" cluster.
The fresh-install seed now showcases the framework instead of
narrating itself.

**Pages**

Four pages, each composed of multiple block types instead of one
rich-text dump:

- **Home** (`/`) — hero → logos-cloud → section-header +
  feature-grid → stats-grid → testimonials → tabs → pricing →
  faq → cta. Thirteen blocks total. Exercises every PR-A primitive
  plus the existing hero / feature-grid / pricing / faq / cta
  built-ins. An operator landing on a fresh install sees what the
  page builder actually does.
- **About** — section-header + rich-text + feature-grid (three
  values cards).
- **Pricing** — section-header + pricing tiers + faq.
- **Contact** — section-header + contact-form + supplemental
  rich-text.

**Posts**

Five posts with real prose (3–4 paragraphs each), tagged with
seeded taxonomy terms:

1. *Building Your First NexPress Plugin* — published 14d ago,
   tagged `Plugins`, `Tutorials`.
2. *How the Page Builder's Container Contracts Keep Pages Valid*
   — published 7d ago, tagged `Framework`.
3. *Themes Without Forks: Tokens, Overlays, and the Layered Merge*
   — published 3d ago, tagged `Themes`, `Framework`.
4. *Reading Time and Reactions in Thirty Lines Each* — published
   yesterday, tagged `Plugins`, `Tutorials`.
5. *Coming Soon: What's Next on the Roadmap* — `publishedAt` 7d
   in the future, status `draft`. Demonstrates the
   scheduled-publish job promoting drafts when their timestamp
   passes.

**Taxonomies**

Four seed tags (`Framework`, `Plugins`, `Themes`, `Tutorials`)
seeded via the existing `taxonomies` collection. Posts reference
them through the relationship field, so the blog template's
tag filters and category sidebars have something to render.

**Navigation**

Updated header (Blog / About / Pricing / Contact / Discussions)
and footer (About / Pricing / Contact / GitHub) to match the new
page set.

**API surface**

`SeedAllResult` gains a `taxonomies: SeedTaxonomiesResult` field,
and `seedAll` now seeds taxonomies first (posts reference tag
ids). The `/api/admin/setup` endpoint's `seeded` summary gains a
`tags: number` field.

**Idempotency**

Each seeder still skips when its target collection already has
rows. Re-running `pnpm seed:content` on a populated install is
a no-op as before.

**What's not in this PR (intentional)**

- No media uploads — would need real binary assets and an
  S3-backed seeder. The hero block uses the existing default
  Unsplash URL; logo placeholders use placehold.co.
- No demo comments / reactions — community feature seeding has
  its own complexity and would expand scope.
- No multi-language translations — single-language only.
