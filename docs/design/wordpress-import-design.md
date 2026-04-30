# WordPress Import — Design

> ⚠️ **Frozen design snapshot.** Phase 21 (the WordPress import path)
> shipped 21.1–21.17 and the follow-up issues are closed. For live
> usage see `docs/wordpress-import-guide.md`; this file is the
> design rationale only.
>
> Last verified against: 3ee45df (2026-04-30) — design decisions
> (job-queue-driven import, idempotent batch model, term/category
> preservation) match implementation. Visibility flag and other
> post-21 follow-ups landed without revising this file.

> Phase 21 ships NexPress's WordPress migration path. This is the
> design doc that frames Phase 21.1 → 21.x; sub-phase implementations
> reference back to the decisions captured here. Read this before
> reviewing the code PRs.

---

## 1. Why This Phase Exists

The product summary (`docs/nexpress-summary.txt`) lists "Phase 5
WordPress 마이그레이션 — 콘텐츠/미디어 이전" as one of the high-level
roadmap pillars. Until an operator can move an existing WordPress
site to NexPress without rebuilding content from scratch, the
"WordPress alternative" framing is aspirational at best. This phase
delivers that path.

Concretely: an operator with a WordPress site exports a WXR file,
runs `pnpm wp-import <wxr-file>` against a fresh NexPress install,
and ends up with their posts, pages, media, taxonomies, and
permalink structure preserved.

---

## 2. Scope

### In scope (Phase 21)

- **WXR (WordPress eXtended RSS) parser** — the canonical export
  format that ships with WordPress core. XML, well-specified.
- **Posts and pages** with content conversion (HTML/Gutenberg →
  Lexical rich text JSON).
- **Featured images and inline media** — download from the source
  site, re-upload through NexPress's media service, rewrite content
  references.
- **Categories and tags** — surfaced as collection fields. Phase
  21.6 lands a small "taxonomies" collection in the reference app
  so the importer has somewhere to put them; user projects opt in
  via config.
- **Authors** — mapped to NexPress staff users (default) or
  members (opt-in via config). The mapping is operator-driven; we
  don't auto-create staff accounts without explicit consent.
- **Comments** — imported into `nx_comments`. Anonymous
  commenters become a single shared "Imported guest" member by
  default; configurable.
- **Custom post types** — config-driven. The operator declares
  `{ wpType: "product", collection: "products" }` mappings;
  unmapped CPTs are skipped with a warning.
- **CLI entrypoint** — `pnpm wp-import <wxr-file> [--dry-run]
[--config <path>]`. Idempotent on slug; re-running with the same
  WXR is safe.
- **Audit log entries** — every imported document records to
  `nx_audit_events` with `action: "import.wp.*"` so operators can
  trace what landed.

### Explicitly out of scope

- **WordPress plugins / shortcodes beyond the core six** — `[gallery]`,
  `[caption]`, `[audio]`, `[video]`, `[playlist]`, `[embed]` map
  to native Lexical / block equivalents. Anything else (ACF,
  Yoast, Elementor) is content-shape-specific and stays the
  operator's problem. We document the conversion path; we don't
  ship plugins for it.
- **Theme migration** — themes are tightly tied to WordPress's
  template hierarchy and PHP. The operator picks a NexPress
  theme; the importer doesn't try to translate `style.css` /
  `functions.php`.
- **Live sync / two-way bridge** — one-shot migration only. If
  the operator keeps writing on WordPress after the import, they
  re-import or merge by hand. Two-way is a separate Phase 22+
  initiative if the demand surfaces.
- **WordPress.com API import** — the WXR export covers it; we
  don't add a separate code path against the .com REST API.
- **Multi-site WordPress (MU)** — the operator runs the importer
  once per WP site against a NexPress site. Phase 15 multi-site
  on the NexPress side handles the receiving end.

---

## 3. Architecture

### Data flow

```
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  WXR file    │ →  │   parse      │ →  │  normalize   │
   │  (XML)       │    │   (xml-js)   │    │  (Intermediate│
   └──────────────┘    └──────────────┘    │   Record)    │
                                            └──────┬───────┘
                                                   │
                       ┌───────────────────────────┴───────┐
                       │                                   │
                ┌──────▼──────┐                     ┌──────▼──────┐
                │   plan      │                     │   apply     │
                │  (dry-run)  │                     │ (writes via │
                │             │                     │  pipeline)  │
                └──────┬──────┘                     └──────┬──────┘
                       │                                   │
                ┌──────▼──────┐                     ┌──────▼──────┐
                │ summary     │                     │ audit log   │
                │ to stdout   │                     │ + report    │
                └─────────────┘                     └─────────────┘
```

The intermediate record (IR) shape is the seam: parser outputs IR,
applier consumes IR. Two benefits:

1. The parser stays free of NexPress-specific concerns; future
   adapters (Ghost, Drupal, generic JSON) plug in by emitting the
   same IR.
2. The applier never sees XML; it tests against in-memory IR
   fixtures, no WP fixture files needed in unit tests.

### Where the code lives

- `packages/wp-import/` — new workspace package
  - `src/parse/` — WXR XML → IR
  - `src/normalize/` — content conversion (HTML → Lexical),
    media URL extraction, slug normalization
  - `src/apply/` — IR → DB writes via `@nexpress/core` pipeline
  - `src/cli/` — `wp-import` command entry
- `apps/web/scripts/wp-import.ts` — thin shim that wires
  `@nexpress/wp-import` into the reference app's bootstrap (loads
  `nexpress.config.ts`, ensures core services, calls the
  importer).

The package is **opt-in**, not a core dependency. `@nexpress/core`
doesn't import it. Operators install the CLI when they need it.

---

## 4. WXR → Intermediate Record

The IR is a TypeScript-typed normalized shape. Sketch:

```ts
interface WpImportRecord {
  /** Post id from the WXR (numeric, used for cross-references). */
  wpId: number;
  /** "post" | "page" | custom post type slug. */
  wpType: string;
  status: "publish" | "draft" | "private" | "pending" | "trash";
  slug: string;
  title: string;
  excerpt: string | null;
  /** Raw HTML / Gutenberg content from <content:encoded>. */
  rawContent: string;
  /** Author id from <wp:post_author>. Resolved later. */
  wpAuthorId: number;
  /** ISO timestamp from <wp:post_date_gmt>. */
  publishedAt: string;
  /** ISO from <wp:post_modified_gmt>. */
  updatedAt: string;
  /** Categories + tags, by taxonomy. */
  terms: WpTerm[];
  /** Resolved <wp:postmeta> entries — `_wp_attached_file` etc. */
  meta: Record<string, string>;
  /** Inline `<img src>` urls + featured image. Resolved later. */
  mediaRefs: MediaRef[];
  /** Comments attached to this post in the WXR. */
  comments: WpComment[];
}

interface WpTerm {
  taxonomy: "category" | "post_tag" | string;
  slug: string;
  name: string;
}

interface MediaRef {
  /** Source URL on the WP site. */
  sourceUrl: string;
  /** WP attachment id, when present. */
  wpAttachmentId: number | null;
  /** "featured" | "inline" — drives where to wire the result. */
  kind: "featured" | "inline";
}

interface WpAuthor {
  wpId: number;
  login: string;
  email: string;
  displayName: string;
}

interface WpComment {
  wpId: number;
  parentWpId: number | null;
  authorName: string;
  authorEmail: string | null;
  authorUrl: string | null;
  date: string;
  content: string;
  approved: boolean;
}
```

The applier walks the IR and writes through the existing
`@nexpress/core` pipeline (`saveDocument`, `setMediaDb`, etc.) so
hooks fire and revisions land. **No raw SQL writes from the
importer.**

---

## 5. Content Conversion (HTML → Lexical)

The hardest part. WP content can be:

1. **Classic editor** — raw HTML with auto-paragraphs.
2. **Gutenberg / block editor** — HTML annotated with
   `<!-- wp:paragraph --> ... <!-- /wp:paragraph -->` comments.
3. **Shortcodes** — `[gallery ids="1,2,3"]`, `[caption]…[/caption]`.
4. **Inline `<img>`** with `wp-image-{id}` classes pointing at
   media library entries.

### Strategy

- **Gutenberg blocks** map directly: each WP block has a NexPress
  Lexical equivalent or a fallback HTML node. We ship a parser
  that walks the comment-fence syntax and emits Lexical AST.
- **Shortcodes** — only the six core ones get explicit handlers.
  Unknown shortcodes pass through as plain text with a warning
  logged to the audit row.
- **Classic HTML** — rehype + a small adapter to Lexical. Tags we
  don't recognize render as plain text.
- **Inline media references** are extracted before conversion so
  the applier can rewrite them to NexPress media ids after
  upload.

Phase 21.4 ships the conversion module + a test fixture set
(snapshot tests against representative WP exports).

---

## 6. Media Pipeline

For every `MediaRef` in an IR record:

1. Download the source URL using `fetch` (with a configurable
   per-host concurrency cap — default 4).
2. Detect MIME from the response, validate against the framework's
   allow-list (same allow-list the upload route enforces).
3. Hand the bytes + filename to `mediaService.upload(...)` so the
   normal Sharp pipeline / dimension extraction / storage adapter
   logic runs.
4. Record a mapping `wpAttachmentId → nx_media.id` in an
   in-memory cache so subsequent records reusing the same
   attachment don't re-download.
5. Rewrite content references (Lexical `image` nodes pointing at
   the source URL) to point at the new media id.

Failure handling:

- **404 on the source URL** — log `error` to audit, skip the
  media node in content (renders as broken link), continue.
- **Timeout** — retry once with backoff, then same as 404.
- **MIME rejected** — log `warn`, skip, continue.

`--strict` flag flips warnings to fatal so operators who want a
clean import abort instead.

---

## 7. Authors and Comments

### Authors

Default behavior: every WP author gets a NexPress staff user
created with `role: "viewer"` and a flagged email
(`<original-email>+wp-import@<domain>` or operator-configured
suffix). Operators promote them after import; we don't grant any
write access during the import itself.

Opt-out via `--no-create-authors`: posts get assigned to the
operator running the import (a single staff user), and the
original author name lands in a `wpOriginalAuthor` meta field on
the document. Useful for one-person blogs.

### Comments

Anonymous and pseudonymous WP commenters become rows on
`nx_members` with:

- `handle`: derived from `authorName` (slugified, suffixed with
  `-wpimp` to avoid collisions).
- `email`: the WP-recorded email, or `null` if missing.
- `password`: a random hash (no one logs in as them).
- `status`: "imported" — a new value on the existing status enum.
  We add the migration in Phase 21.7.

The "imported" status:

- Doesn't allow login.
- Doesn't fire `notification:*` rows on inbound comments.
- Renders the comment with `(imported)` next to the handle in
  default themes, so visitors know it's archived rather than live.

Operators can run a follow-up CLI (`wp-import claim`) to merge an
imported member into an existing live member by handle / email
match.

---

## 8. Custom Post Types

Operator declares mappings in a config file:

```toml
# wp-import.config.toml
[[mappings]]
wp_type = "product"
collection = "products"

[[mappings]]
wp_type = "event"
collection = "events"
field_overrides = { "_event_date" = "eventDate" }
```

Field overrides remap WP post-meta keys to collection fields.
Without an override, post-meta is dropped (with a `warn` log
listing the keys, so the operator notices what's getting lost).

Posts whose `wpType` isn't in the config are **skipped with a
warning, not an error** — the WXR may include attachments and
nav-menu records the importer doesn't try to land in collections.

---

## 9. Idempotency and Re-runs

The import is keyed on `(collection, slug)` for documents and on
WP attachment id (stored in a meta field) for media. Re-running
the same WXR:

- Documents with matching slug get **skipped**, not overwritten.
  `--update` flag flips to update mode (rewrites content but
  preserves the document id and its revision history).
- Media with matching `wpAttachmentId` meta get skipped.
- Comments get skipped on `(parentDocumentId, wpCommentId)`
  match.
- Authors get skipped on email match.

This keeps incremental imports safe — the operator can WXR-export
again after a few days of new content and re-run; only the new
rows land.

---

## 10. Sub-phase Plan

In rough order, each landing as a separate PR:

| Sub-phase | Scope                                                                | Branches off |
| --------- | -------------------------------------------------------------------- | ------------ |
| **21.1**  | This design doc                                                      | Phase 20.3b  |
| **21.2**  | WXR parser + IR types + parse-only tests (no DB)                     | 21.1         |
| **21.3**  | CLI scaffold + `--dry-run` summary mode                              | 21.2         |
| **21.4**  | Posts/pages content conversion (HTML → Lexical) + applier            | 21.3         |
| **21.5**  | Media download + upload pipeline + content rewrite                   | 21.4         |
| **21.6**  | Categories/tags as collection fields + reference taxonomy collection | 21.5         |
| **21.7**  | Comments + member status enum extension + migration                  | 21.6         |
| **21.8**  | Authors (staff create + opt-out path)                                | 21.7         |
| **21.9**  | Custom post types + config file                                      | 21.8         |
| **21.10** | Production polish — resume on failure, audit log, docs               | 21.9         |

Phase 21.x **does not need to land in order** — 21.7 (comments) and
21.8 (authors) are independent of 21.5 (media). But the dependency
graph above keeps test fixtures small (each sub-phase reuses the
WXR fixture from the prior one).

---

## 11. Open Questions

These need resolution before the relevant sub-phase lands. Listed
here so reviewers can challenge them early.

1. **Lexical conversion library.** Do we write the
   HTML/Gutenberg → Lexical converter ourselves, or wrap an
   existing one? `@lexical/html` exists for the inverse direction
   (Lexical → HTML) but the import direction is sparse on
   tooling. Phase 21.4 will pick.
2. **WXR XML library.** `fast-xml-parser` is the strongest
   candidate — small, no dependencies, streaming-capable for
   large exports. Phase 21.2 confirms after a memory profile on a
   1 GB WXR.
3. **Featured image vs hero block.** Most NexPress themes render
   `coverImage` from the posts collection, not as a content
   block. WP's `_thumbnail_id` post-meta maps cleanly. Confirmed
   no decision needed.
4. **Slug collisions across post types.** WP allows the same
   slug on a post and a page. NexPress collection slugs are
   unique within the collection. Cross-type collisions resolve
   correctly because they live in different collections; same-
   type collisions in WP would already be invalid.
5. **`status: "private"` posts.** WP private posts are visible to
   logged-in users. Phase 21.17 added a `visibility` column to
   every collection and `findDocuments` auto-filters anonymous
   reads to `visibility = "public"`. Private WP posts now
   round-trip as `status="published", visibility="private"` —
   a member or staff principal sees them, anonymous visitors
   and crawlers don't. The Phase 21.4 draft-coercion is gone.
6. **Imported member status enum.** Adding "imported" requires a
   schema migration. Need to confirm with project conventions
   that extending an existing enum mid-flight is acceptable
   (Phase 21.7).

---

## 12. Risks

- **Memory** on large exports. A 5 GB WXR with embedded
  attachments parsed eagerly will OOM the import process. Phase
  21.2 streams the parse; the IR is consumed by the applier
  one record at a time, never fully materialized.
- **Source-site availability** during media download. If the
  WordPress site is being decommissioned mid-migration, media
  URLs go 404. The retry policy + audit log surfaces what's
  missing; operators can WXR-export from a snapshot or re-host
  media before re-running.
- **Lexical AST correctness**. Converted content that round-trips
  through NexPress's renderer must match the operator's
  expectation. Snapshot tests cover the well-known cases; the
  long tail (custom Gutenberg blocks, plugin shortcodes) will
  always need eyeballing on a real export. Phase 21.4 adds a
  `--report-html` flag that emits a side-by-side diff for
  spot-checking.
- **Permalink mismatches**. Themes that render posts at
  `/{year}/{slug}` won't match WP's `/{year}/{month}/{slug}`. The
  importer doesn't rewrite permalinks at the theme level; it
  preserves slug + publish date and the operator's theme is
  responsible for the URL shape. Documented in 21.10.

---

## 13. Open ramps for the next person

Each PR in this Phase opens with a checklist that traces back to
this doc — "this lands the parser side of §4", "this fills the
TODO at §11.1", etc. If you're picking up a sub-phase, start by
re-reading §10 to find your slot, then §11 to see what's still
unresolved in your section.

---

## 14. After Phase 21 ships

Sub-phases 21.1–21.10 all landed. The operator-facing runbook is
`docs/wordpress-import-guide.md` — read that to actually run an
import; this doc stays as the design rationale for reviewers and
future contributors. Outstanding follow-ups (cross-run media
dedup, Gutenberg block-fence parsing, resume markers, per-doc
visibility) are tracked in the project memory file.
