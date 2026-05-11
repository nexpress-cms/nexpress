---
"@nexpress/theme-docs": minor
"@nexpress/theme-portfolio": minor
---

**Docs `/docs/:slug` + portfolio `/work/:slug` theme routes
land — closes #609, #613, #614.**

Three related route-mismatch issues from the 2026-05-10 sweep,
all about theme components emitting URLs the framework had no
way to resolve.

**#609 — Docs theme `/search` shadowed by host file route.**
Per the locked dispatch order (app file > page > theme >
plugin), the reference app's `apps/web/src/app/(site)/search/page.tsx`
takes `/search` before the catch-all can route it. Docs theme's
own search component (`DocsSearch`) was unreachable. The theme
can't override the universal search page, so it scopes its own
search to `/docs/search` — the operator gets both routes
(framework `/search` + docs `/docs/search`). `DocsHeader`'s
form action updates accordingly.

**#614 — Docs `/docs/:slug` links unresolved.** The sidebar
(`packages/themes/docs/src/sidebar.tsx`) and `DocPageTemplate`'s
prev/next bar both emit `/docs/<slug>` links, but the reference
app has no `/docs/[slug]` file route and the framework catch-all
only resolves `pages` rows + theme archive routes. Arbitrary
`docs` collection rows weren't reachable by URL.

Fix: docs theme declares an explicit `/docs/:slug` route
(`routes/doc-detail.tsx`) that looks up the docs row and
renders it through `templates.docs.default` (DocPageTemplate).
Status filter `"published"` matches the catch-all's `pages`
visibility pattern.

Route registration order matters — `/docs/search` precedes
`/docs/:slug` so the literal beats the parametric route
(dispatcher is first-match-wins).

**#613 — Portfolio `/work/:slug` links unresolved.** Same
shape: `PortfolioProjectCard` emits `/work/<slug>` URLs, but
portfolio declared `templates.posts.detail`
(ProjectDetailTemplate) without a route to reach it. The
framework catch-all only resolves `pages` — `posts` rows
addressed as `/work/<slug>` 404'd.

Fix: portfolio gains a `routes` array with
`{ pattern: "/work/:slug", component: PortfolioProjectDetailRoute }`.
The component looks up the posts row by slug + status
`"published"` and renders through
`templates.posts.detail`.

Both new route components live in a `routes/` subdirectory
(matches the forum plugin's layout from PRT.3) and use
`findDocuments<RowShape>` with locally-declared row interfaces
— the schema lives in the operator's project, not the theme,
so `theme:install @nexpress/theme-docs`/
`@nexpress/theme-portfolio` is what reconciles the field set.

## What this DOESN'T solve

`#612` — Reference blog routes (`apps/web/src/app/(site)/blog/`)
still bypass `resolveTemplateComponent("posts", ...)`.
`magazine`'s and `portfolio`'s `templates.posts.{list,detail}`
remain unreachable via the canonical `/blog/*` URLs. Closing
that is an apps/web edit (route delegation through theme
templates) — separate PR with a user decision (which template
wins on collision?), tracked.

`#608` — Theme requirements can't express collection-level
settings (`slugField`, `seo.urlPath`, etc.). Independent of
the route work above; tracked for a follow-up that designs the
contract extension or generates safe defaults in the install
template.
