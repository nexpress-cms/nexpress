---
"@nexpress/theme-portfolio": patch
---

Fix: portfolio's `/work/:slug` detail route now filters by `kind: "project"`, so a `kind="article"` post that happens to share a slug with a project doesn't get routed through `ProjectDetailTemplate`. Pre-fix, an operator who authored an article on a portfolio-themed site could have it accessible at both `/blog/<slug>` (the canonical URL per `posts.seo.urlPath` for kind=article) AND `/work/<slug>` (matched by the portfolio detail route's slug-only query) — the second URL would render the article through `ProjectDetailTemplate`, which expects portfolio-specific fields (hero, year, role, …) and produces a mangled page for an article.

One-line change to the `findDocuments("posts", { where: { … } })` call inside `PortfolioProjectDetailRoute`. Adds `kind: "project"` alongside the existing `slug` + `status: "published"` filters. The route now `notFound()`s for any post whose `kind !== "project"`, matching the framework's `/blog/<slug>` page which already 404s when `post.kind !== "article"`.

Direct follow-up to the seeding fix that landed in the previous release of `@nexpress/theme-portfolio`.
