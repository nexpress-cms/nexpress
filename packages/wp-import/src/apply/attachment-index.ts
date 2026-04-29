import { type WpImportBundle, type WpImportRecord } from "../parse/types.js";

/**
 * Phase 21.4 — index attachment records by their WP id so the
 * applier can resolve `_thumbnail_id` references and inline
 * `wp-image-N` ids to source URLs.
 *
 * Phase 21.5 will replace these source URLs with NexPress media
 * ids after the actual download/upload pipeline runs. For now
 * the applier just preserves the URL on the document so the
 * post body and featured-image references aren't lost.
 */
export interface AttachmentEntry {
  wpAttachmentId: number;
  sourceUrl: string;
  /** WP attachment post-meta — `_wp_attached_file`, dimensions, etc. */
  meta: Record<string, string>;
  /** Original attachment record's title (filename in most exports). */
  title: string;
}

export interface AttachmentIndex {
  /** Look up by numeric WP attachment id. */
  byId: ReadonlyMap<number, AttachmentEntry>;
  /** Look up by source URL — useful for inline img refs that didn't carry an id. */
  byUrl: ReadonlyMap<string, AttachmentEntry>;
}

export function buildAttachmentIndex(bundle: WpImportBundle): AttachmentIndex {
  const byId = new Map<number, AttachmentEntry>();
  const byUrl = new Map<string, AttachmentEntry>();

  for (const record of bundle.records) {
    if (record.wpType !== "attachment") continue;
    const url = pickAttachmentUrl(record);
    const entry: AttachmentEntry = {
      wpAttachmentId: record.wpId,
      sourceUrl: url,
      meta: record.meta,
      title: record.title,
    };
    if (record.wpId > 0) byId.set(record.wpId, entry);
    if (url) byUrl.set(url, entry);
  }

  return { byId, byUrl };
}

/**
 * Attachment records in WXR carry their URL in two places:
 *
 *   - `<wp:attachment_url>` — the canonical primary location.
 *     Phase 21.2 surfaces this via the parser as a `mediaRefs`
 *     entry with `kind: "inline"` and `wpAttachmentId: null`.
 *   - `<guid>` — the original WP-side permalink. Some plugins
 *     write the actual file URL here too.
 *
 * Take whichever the parser captured first.
 */
function pickAttachmentUrl(record: WpImportRecord): string {
  const fromMediaRef = record.mediaRefs.find((ref) => ref.sourceUrl);
  return fromMediaRef?.sourceUrl ?? "";
}
