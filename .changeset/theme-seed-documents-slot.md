---
"@nexpress/theme": patch
"@nexpress/app": patch
---

Add `NpThemeSeedContent.documents` — seed arbitrary collections
beyond pages/posts.

Themes that bundle their own collections (a magazine theme's
`authors`, a docs theme's `glossary`, a portfolio's `clients`)
previously had no way to ship matching demo data. The two
first-class slots (`pages`, `posts`) covered the common case but
left every other collection blank after first-boot — operators
had to hand-author the first row themselves.

The new slot is keyed by collection slug:

```ts
seedContent: {
  documents: {
    authors: [
      { slug: "ada", title: "Ada Lovelace", data: { bio: "…" } },
    ],
    glossary: [
      { slug: "lexical", title: "Lexical", data: { definition: "…" } },
    ],
  },
}
```

Each `NpThemeSeedDocument` is `{ slug, title, status?,
publishedAt?, data? }`. The `data` payload is merged onto the
document; the pipeline's Zod validation strips fields the
collection doesn't declare, so themes don't have to gate on each
operator's exact field list.

Seeder behavior matches the existing pages/posts slots:

- Idempotent per collection — skipped when the collection has
  any row.
- Unknown collection slugs (theme references a collection the
  operator hasn't activated) are logged at warn level and
  reported as `unknown: true` in `SeedAllResult.documents[slug]`,
  rather than aborting the wizard.
- `author: actor.id` is auto-injected for collections that
  declare an `author` field, so themes don't have to know the
  operator's user id.

The setup wizard's response gains a `seeded.documents` map
keyed by collection slug. `NpThemeSeedDocument` joins the v0.1
stable seed-content surface (adding optional fields is
non-breaking).

Closes follow-up HIGH #2 from the theme redesign track.
