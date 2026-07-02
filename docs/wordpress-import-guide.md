# WordPress Import — Operator Guide

> Practical runbook for migrating a WordPress site into NexPress
> using the Phase 21 importer. The design rationale lives in
> `docs/design/wordpress-import-design.md` (frozen snapshot).
> Read this when you're about to run an import.

---

## 1. What the importer covers

| In                                         | Out                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Posts + pages (HTML / Gutenberg → Lexical) | Theme migration                                                               |
| Featured images + inline `<img>`           | Plugin shortcodes beyond gallery / caption / audio / video / playlist / embed |
| Categories + tags                          | WordPress.com REST API (use the WXR export instead)                           |
| Authors → staff users (role: viewer)       | Multi-site WordPress (run once per site)                                      |
| Comments → imported guest members          | Live two-way sync                                                             |
| Custom post types via config               |                                                                               |
| Audit log entries (`import.wp.*`)          |                                                                               |

---

## 2. Prerequisites

1. A WXR export from the source site — `wp-admin → Tools → Export → Download Export File`. Pick "All content" unless you only want a subset.
2. A NexPress site with at least one staff admin user. Run `pnpm seed:admin` if you haven't already.
3. The framework's split-taxonomy collections (`categories` + `tags`, shipped from `@nexpress/app/collections/{categories,tags}` and re-exported in every scaffold under `src/collections/`). Phase 21.6's single `taxonomies` collection was split into the two; user projects opt in by keeping those wrappers around (the scaffold does so by default), or by skipping the taxonomy resolver in the shim.

The importer reads `DATABASE_URL` and uses the framework's existing storage adapter (local or S3 — whichever your config selects).

---

## 3. Quickstart

### Admin screen

Open `/admin/import/wordpress`, choose the WXR file, run **Preview**, then run
**Apply** with the same file and options. Preview is immediate; Apply creates
a background import run, enqueues it through the NexPress job queue, and polls
the run until it succeeds or fails. Recent runs stay visible on the same screen
with status, job id, lifecycle logs, and the final report.

Preview is a dry run: it parses the file, plans post/page writes, and walks
media references without downloading or uploading. Taxonomy, comment, and
author resolver results are only final after Apply because those steps depend
on live DB writes.

Background Apply requires jobs to be wired on the web runtime and drained by a
worker:

```bash
NP_ENABLE_JOBS=1 pnpm worker
```

The web process that receives the Apply request also needs `NP_ENABLE_JOBS=1`
so it can enqueue the run. The uploaded WXR body is stored temporarily in
`np_import_runs.source_xml` and cleared when the run reaches a terminal state.
The admin endpoint keeps the same 25 MB upload cap as the preview route.

Admin options map to the CLI behavior:

| Admin option            | CLI equivalent                                |
| ----------------------- | --------------------------------------------- |
| Update existing slugs   | `--update`                                    |
| Strict failures         | `--strict`                                    |
| Create imported authors | default on / `--no-create-authors` off        |
| Include media pipeline  | default on; turn off for a content-only apply |

Use the CLI for exports beyond the admin upload cap, custom-post-type mappings,
resume markers, or HTML/Lexical diff reports.

### CLI

```bash
# Preview — parse the WXR and print a summary
pnpm wp-import path/to/export.xml

# Walk records + media against the live DB without writing
pnpm wp-import path/to/export.xml --apply --dry-run

# Real import — writes posts, pages, taxonomies, members,
# comments, audit events, downloads + uploads media
pnpm wp-import path/to/export.xml --apply
```

Run the previews first. They surface anything that needs an
operator decision (custom post types without mappings, missing
attachment URLs, taxonomy collisions) before any DB row is
written.

---

## 4. CLI flags

| Flag                        | Default             | Effect                                                                                                                                                                                 |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--apply`                   | off                 | Switch from preview-only to applier mode. Without this flag the importer parses + summarises without touching the DB.                                                                  |
| `--dry-run`                 | on (with `--apply`) | When combined with `--apply`, walks records + media but skips the actual writes. Useful for spotting collisions on a real DB.                                                          |
| `--no-create-authors`       | off                 | Don't create `np_users` rows for WP authors. Imported posts come in without an author wired and the original byline lands on `wpOriginalAuthor`.                                       |
| `--config <path>`           | none                | Load custom-post-type → collection mappings from a JSON file (see §6).                                                                                                                 |
| `--strict`                  | off                 | Escalate sub-pipeline warnings (media 4xx / MIME reject / taxonomy / author resolver failures) into errors so the CLI exits non-zero. Use for "clean import or nothing" runs.          |
| `--update`                  | off                 | Rewrite the existing document instead of skipping when a slug collides. Comments are NOT re-imported on an update pass — that needs the per-comment idempotency keys landing in 21.14. |
| `--report-html`             | off                 | Write a side-by-side HTML/Lexical diff of every imported record so you can spot-check the conversion. Defaults to `<wxr>.report.html`.                                                 |
| `--report-html-path <path>` | —                   | Override the default report path. Implies `--report-html`.                                                                                                                             |
| `--resume`                  | off                 | Read + persist a sidecar resume marker so re-runs skip already-imported documents and dedupe comments by `wpCommentId`. Defaults to `<wxr>.import-state.json`.                         |
| `--resume-state <path>`     | —                   | Override the default resume-marker path. Implies `--resume`.                                                                                                                           |
| `--help`                    | —                   | Show the usage block.                                                                                                                                                                  |

---

## 5. What the apply pass does, in order

1. **Media pipeline.** Downloads every attachment + inline `<img src>`, validates the MIME against the framework's allowlist (`image/*`, `video/*`, `application/pdf`), uploads through `mediaService.upload` so the Sharp pipeline + storage adapter run as normal. 404s are logged + skipped; transient network failures retry once.
2. **Taxonomies.** Resolves every WP `<category>` / `<post_tag>` term once via the shim's resolver (find-by-slug → create-if-missing in `taxonomies` collection).
3. **Authors.** Resolves each unique `<dc:creator>` login once. Default behavior creates a `role: "viewer"` staff user with a flagged email (`<original>+wp-import@<domain>`). The `--no-create-authors` flag swaps in a resolver that returns null.
4. **Per-record.** For each post / page / mapped CPT:
   - Skip if the slug already exists (idempotent re-run).
   - Convert `content:encoded` HTML to Lexical, rewrite image refs to NexPress media ids, set `coverImage` from `_thumbnail_id`.
   - Apply category/tag/author ids to the relationship fields.
   - Apply mapped postmeta values to the configured field overrides.
   - Save via `saveDocument` (so hooks fire and revisions land).
   - Record an `import.wp.applied` audit event.
   - Walk the record's WP comments — find-or-create `imported`-status members per author, insert directly into `np_comments`.

Skips and errors emit `import.wp.skipped` / `import.wp.error` audit events alongside the structured summary printed at the end.

---

## 6. Custom post types — config file shape

```json
{
  "mappings": [
    {
      "wpType": "product",
      "collection": "products"
    },
    {
      "wpType": "event",
      "collection": "events",
      "fieldOverrides": {
        "_event_date": "eventDate",
        "_event_location": "location"
      }
    }
  ]
}
```

- `wpType` — the value in `<wp:post_type>` on the source record.
- `collection` — the NexPress collection slug to route into. The collection must exist in your `nexpress.config.ts` and have a matching schema (run `pnpm db:generate && pnpm db:migrate`).
- `fieldOverrides` — optional. Maps WP `<wp:postmeta>` keys to NexPress collection field names. Empty values are dropped. Protected fields (`title`, `slug`, `content`, `excerpt`, `publishedAt`, `coverImage`, `categories`, `tags`, `author`) can never be overridden — a misconfigured override is a no-op, not a corrupt post.

Snake-case keys (`wp_type`, `field_overrides`) are also accepted so the design doc's TOML example translates directly.

---

## 7. Idempotency — what re-runs do

Re-running the same WXR against the same DB:

| What             | Behavior                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documents        | Skipped on slug match (or by resume marker when `--resume` is on). Listed under `Skipped` with reason "slug already exists" or "resume marker — already imported". |
| Authors          | Skipped on email match (the `+wp-import` flagged variant).                                                                                                         |
| Taxonomy terms   | Skipped on slug match.                                                                                                                                             |
| Imported members | Skipped on handle match.                                                                                                                                           |
| Comments         | Skipped on `wpCommentId` match when the resume marker is enabled (Phase 21.14). Without `--resume`, comments only land for posts the applier created in this run.  |
| Media            | Cross-run dedup via byte-hash lookup against `np_media.hash` (Phase 21.13). Identical bytes reuse an existing row instead of producing a duplicate.                |

The audit log carries the full forensic trail — query `np_audit_events` filtered by `action LIKE 'import.wp.%'` to see what each run did.

---

## 8. Common situations

**WP author count exploded after import.**
You ran without `--no-create-authors` and the source site had a long contributor list. Either delete the unwanted `np_users` rows whose email ends in `+wp-import@<domain>`, or re-run from a clean DB with `--no-create-authors`.

**Media URLs 404.**
The source WP site was decommissioned or has its uploads dir behind auth. Either re-host the originals at the original URLs, snapshot the `wp-content/uploads` dir into a static server, or accept the broken-image fallout — the audit log lists exactly which URLs failed.

**Comments look spammy.**
The WP site's spam filter wasn't catching the unapproved tail. The importer drops anything with `<wp:comment_approved>` != `"1"`, but a permissive moderator may have approved spam. Cleaning this up is a `np_comments` admin pass after the import — the audit trail at least tells you which run brought them in.

**The post body used Gutenberg block comments (`<!-- wp:paragraph -->`).**
The converter strips block fences and preserves the inner content. Core block
attributes that affect structure are honored for common blocks such as
headings, lists, images, embeds, separators, spacers, quotes, and nested layout
wrappers. Unknown custom blocks fall back to their inner HTML and add a
Gutenberg conversion warning to the import notes so you know which records need
a manual spot-check.

---

## 9. Operational checklist

Before running `--apply`:

- [ ] Backup the DB (`pg_dump -Fc nexpress > before-wp-import.dump`).
- [ ] Run `pnpm wp-import <wxr> --apply --dry-run` and skim the summary.
- [ ] Confirm taxonomy + author counts look sane.
- [ ] Confirm the media URL list doesn't include anything with credentials in the path.
- [ ] Confirm the audit log table is reachable (`SELECT count(*) FROM np_audit_events`).

After:

- [ ] Spot-check a few posts in the admin — content rendering, cover image, taxonomy chips.
- [ ] Confirm `np_audit_events` has the expected number of `import.wp.applied` rows.
- [ ] Promote any `viewer`-role staff users you actually want as authors (or delete the rest).
- [ ] If you need archived discussion to render distinctly, tweak your theme to flag members with `status === "imported"`.
