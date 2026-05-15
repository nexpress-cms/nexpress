---
"@nexpress/core": patch
"@nexpress/theme-magazine": patch
---

chore(theme-magazine): use np_users for bylines instead of a separate authors collection

The magazine theme used to declare its own `authors` collection
(`name` + `bio`, `createIfAbsent: true`) and point
`posts.author` at it. That table mirrored what `np_users`
already provides — every staff/editor user has `name`, and is
referenceable by id — and ran on the bundled-themes prebake
path, so every scaffolded site got an empty `np_c_authors`
table whether magazine was active or not.

Magazine now matches the built-in `posts` collection in
`@nexpress/app`: `author` is `relationTo: "users"`. Bylines
resolve through `np_users` directly. The byline render path
in `archives.tsx` / `post-feature.tsx` / `post-card.tsx` was
already shape-agnostic (`author.name` works on either row), so
no template change is needed.

**Author archive at `/author/:id`** — the route stays, but now
queries `np_users` via the new `getUserById` helper exported
from `@nexpress/core/auth` (mirrored at the package root). The
"author bio" sub-line on the archive header is dropped — bio
is not part of the `np_users` schema. Sites that want guest
authors without admin accounts can re-add an authors collection
on their own; the framework no longer ships one by default.

New on `@nexpress/core`:

  - `getUserById(id): Promise<NpUserBasic | null>` — minimal
    `{ id, name, email }` projection. The supported entry point
    for theme code that needs to render a byline from
    `posts.author: relationTo("users")`. Available from both
    the package root and `@nexpress/core/auth`.

Migration: sites that activated magazine before this release
have an `np_c_authors` table in their database. Drizzle won't
drop it (the framework only adds via `createIfAbsent`); operators
can drop it manually if it's empty. Magazine no longer reads
that table.
