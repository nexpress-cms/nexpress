# WordPress Import — Operator Guide

> Practical runbook for migrating a WordPress site into NexPress
> using the Phase 21 importer. Pairs with
> `docs/wordpress-import-design.md`, which is the design rationale.
> Read this when you're about to run an import.

---

## 1. What the importer covers

| In | Out |
|----|-----|
| Posts + pages (HTML / Gutenberg → Lexical) | Theme migration |
| Featured images + inline `<img>` | Plugin shortcodes beyond gallery / caption / audio / video / playlist / embed |
| Categories + tags | WordPress.com REST API (use the WXR export instead) |
| Authors → staff users (role: viewer) | Multi-site WordPress (run once per site) |
| Comments → imported guest members | Live two-way sync |
| Custom post types via config | |
| Audit log entries (`import.wp.*`) | |

---

## 2. Prerequisites

1. A WXR export from the source site — `wp-admin → Tools → Export → Download Export File`. Pick "All content" unless you only want a subset.
2. A NexPress site with at least one staff admin user. Run `pnpm seed:admin` if you haven't already.
3. The reference app's `taxonomies` collection (Phase 21.6 — already in `apps/web/src/collections/taxonomies.ts`). User projects opt in by registering an equivalent collection or by skipping the `taxonomies` resolver in the shim.

The importer reads `DATABASE_URL` and uses the framework's existing storage adapter (local or S3 — whichever your config selects).

---

## 3. Quickstart

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

| Flag | Default | Effect |
|------|---------|--------|
| `--apply` | off | Switch from preview-only to applier mode. Without this flag the importer parses + summarises without touching the DB. |
| `--dry-run` | on (with `--apply`) | When combined with `--apply`, walks records + media but skips the actual writes. Useful for spotting collisions on a real DB. |
| `--no-create-authors` | off | Don't create `nx_users` rows for WP authors. Imported posts come in without an author wired and the import operator gets the credit via `createdBy` / `updatedBy`. |
| `--config <path>` | none | Load custom-post-type → collection mappings from a JSON file (see §6). |
| `--help` | — | Show the usage block. |

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
   - Walk the record's WP comments — find-or-create `imported`-status members per author, insert directly into `nx_comments`.

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

| What | Behavior |
|------|----------|
| Documents | Skipped on slug match. Listed under `Skipped` with reason "slug already exists". |
| Authors | Skipped on email match (the `+wp-import` flagged variant). |
| Taxonomy terms | Skipped on slug match. |
| Imported members | Skipped on handle match. |
| Comments | Only land for posts the applier created in this run, so re-runs naturally skip them. |
| Media | Re-downloaded (Phase 21.5 doesn't cross-run dedupe). Hash dedup landing alongside resume markers is on the long-tail follow-up list. |

The audit log carries the full forensic trail — query `nx_audit_events` filtered by `action LIKE 'import.wp.%'` to see what each run did.

---

## 8. Common situations

**WP author count exploded after import.**
You ran without `--no-create-authors` and the source site had a long contributor list. Either delete the unwanted `nx_users` rows whose email ends in `+wp-import@<domain>`, or re-run from a clean DB with `--no-create-authors`.

**Media URLs 404.**
The source WP site was decommissioned or has its uploads dir behind auth. Either re-host the originals at the original URLs, snapshot the `wp-content/uploads` dir into a static server, or accept the broken-image fallout — the audit log lists exactly which URLs failed.

**Comments look spammy.**
The WP site's spam filter wasn't catching the unapproved tail. The importer drops anything with `<wp:comment_approved>` != `"1"`, but a permissive moderator may have approved spam. Cleaning this up is a `nx_comments` admin pass after the import — the audit trail at least tells you which run brought them in.

**The post body has stray Gutenberg comment fences (`<!-- wp:paragraph -->`).**
Phase 21.4's converter is comment-aware in design but the v1 cut treats them as text. Run a follow-up cleanup pass via the editor or the framework's revision tools. A future sub-phase may layer real Gutenberg-block parsing on top.

---

## 9. Operational checklist

Before running `--apply`:

- [ ] Backup the DB (`pg_dump -Fc nexpress > before-wp-import.dump`).
- [ ] Run `pnpm wp-import <wxr> --apply --dry-run` and skim the summary.
- [ ] Confirm taxonomy + author counts look sane.
- [ ] Confirm the media URL list doesn't include anything with credentials in the path.
- [ ] Confirm the audit log table is reachable (`SELECT count(*) FROM nx_audit_events`).

After:

- [ ] Spot-check a few posts in the admin — content rendering, cover image, taxonomy chips.
- [ ] Confirm `nx_audit_events` has the expected number of `import.wp.applied` rows.
- [ ] Promote any `viewer`-role staff users you actually want as authors (or delete the rest).
- [ ] If you need archived discussion to render distinctly, tweak your theme to flag members with `status === "imported"`.
