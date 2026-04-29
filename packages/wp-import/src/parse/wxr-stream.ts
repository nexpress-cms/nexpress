import { createReadStream } from "node:fs";

import {
  type WpImportRecord,
  type WpSiteInfo,
  type WpAuthor,
  type WpTerm,
} from "./types.js";
import { parseWxr } from "./wxr.js";

/**
 * Phase 21.16 — streaming WXR parse for huge exports.
 *
 * The eager `parseWxr(string)` path stays as the canonical small-
 * export tool: it loads the whole file into memory which is fine
 * up to a few hundred megabytes. For 5 GB+ WXR exports (large WP
 * sites with embedded media), eager parsing OOMs the process, so
 * this module provides an async-iterable equivalent that:
 *
 *   1. Reads the file in chunks via `createReadStream`.
 *   2. Loads the channel header (site / authors / channel-level
 *      terms) once it's fully buffered. The header is small —
 *      WP writes it before the first `<item>` and it's bounded by
 *      the author count, not the post count.
 *   3. Scans the rolling buffer for `<item>...</item>` slices and
 *      hands each to the existing `parseWxr` machinery wrapped in
 *      a tiny `<channel>` envelope so the parser still recognises
 *      the structure.
 *   4. Yields one `WpImportRecord` per item; peak memory stays
 *      bounded by the largest single item rather than the whole
 *      file.
 *
 * Limitations:
 *
 *   - Items larger than the buffer threshold (default 64 MB) are
 *     surfaced as an explicit error rather than silently growing
 *     the buffer; that's the early-warning signal that a record's
 *     `<content:encoded>` is degenerate (a 60 MB embedded base64
 *     image, for example) and needs the operator to intervene.
 *   - This is a structural streamer only — the applier still
 *     consumes the records eagerly today. The Phase 21.16 cut
 *     gives operators the primitive; a future sub-phase wires it
 *     end-to-end through `applyBundle` so peak memory stays low
 *     for the full pipeline too.
 */

export interface WpImportStreamHeader {
  site: WpSiteInfo;
  authors: WpAuthor[];
  /** Channel-level <wp:category> / <wp:tag> / <wp:term> entries. */
  terms: WpTerm[];
}

export interface WpImportStream {
  header: WpImportStreamHeader;
  items: AsyncIterable<WpImportRecord>;
}

export interface WpImportStreamOptions {
  /** Read-stream chunk size in bytes. Default 64 KB. */
  highWaterMark?: number;
  /**
   * Hard cap on the rolling buffer between item boundaries — when
   * a single `<item>...</item>` slice exceeds this we abort
   * rather than growing memory unbounded. Default 64 MB.
   */
  maxItemBytes?: number;
}

const DEFAULT_HIGH_WATER_MARK = 64 * 1024;
const DEFAULT_MAX_ITEM_BYTES = 64 * 1024 * 1024;
const ITEM_OPEN = "<item>";
const ITEM_CLOSE = "</item>";

export class WpImportStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WpImportStreamError";
  }
}

/**
 * Open a streaming reader over a WXR file. Resolves with the
 * channel header + an async iterator of items.
 */
export async function parseWxrStream(
  path: string,
  options: WpImportStreamOptions = {},
): Promise<WpImportStream> {
  const highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
  const maxItemBytes = options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES;

  const stream = createReadStream(path, { encoding: "utf8", highWaterMark });
  const reader = stream[Symbol.asyncIterator]() as AsyncIterator<string>;

  // Phase 1: read until we find the first <item> opener so we can
  // capture the channel header in a single eager pass. WP writes
  // <channel> with all author / term entries before the first
  // <item>, so the prefix is small (typically a few KB).
  let buffer = "";
  let firstItemAt = -1;
  while (firstItemAt < 0) {
    const next = await reader.next();
    if (next.done) break;
    buffer += next.value;
    firstItemAt = buffer.indexOf(ITEM_OPEN);
    if (buffer.length > maxItemBytes && firstItemAt < 0) {
      throw new WpImportStreamError(
        `header exceeded ${maxItemBytes} bytes without finding any <item> — is this a WXR file?`,
      );
    }
  }

  // Build a synthetic "header-only" XML by closing the channel /
  // rss tags right before the first item. The eager parser
  // handles this cleanly because it tolerates an empty `item`
  // array.
  const headerXml =
    firstItemAt >= 0
      ? buffer.slice(0, firstItemAt) + "</channel></rss>"
      : buffer + "</channel></rss>";
  const headerBundle = parseWxr(headerXml);

  const tail = firstItemAt >= 0 ? buffer.slice(firstItemAt) : "";

  // Phase 2: yield items one at a time. Each item pulls the next
  // </item> boundary out of the rolling buffer and wraps the
  // slice in `<channel>` so `parseWxr` still works. We re-use the
  // existing parser to keep the field-mapping logic in one place.
  async function* iterate(): AsyncIterableIterator<WpImportRecord> {
    let local = tail;
    let exhausted = false;
    while (true) {
      const open = local.indexOf(ITEM_OPEN);
      if (open < 0) {
        if (exhausted) return;
        const next = await reader.next();
        if (next.done) {
          exhausted = true;
          continue;
        }
        local += next.value;
        if (local.length > maxItemBytes) {
          throw new WpImportStreamError(
            `WXR item exceeded ${maxItemBytes} bytes — abort. Likely an embedded base64 payload that won't fit; raise --max-item-bytes if you really need it.`,
          );
        }
        continue;
      }
      const close = local.indexOf(ITEM_CLOSE, open);
      if (close < 0) {
        // Need more input.
        const next = await reader.next();
        if (next.done) {
          if (exhausted) return;
          exhausted = true;
          continue;
        }
        local += next.value;
        if (local.length > maxItemBytes) {
          throw new WpImportStreamError(
            `WXR item exceeded ${maxItemBytes} bytes — abort.`,
          );
        }
        continue;
      }
      const itemEnd = close + ITEM_CLOSE.length;
      const itemSlice = local.slice(open, itemEnd);
      local = local.slice(itemEnd);
      // Wrap this single item back in the synthetic envelope and
      // hand it to the eager parser so the field-mapping code
      // stays canonical.
      const wrapped = wrapInChannel(itemSlice);
      const single = parseWxr(wrapped);
      const record = single.records[0];
      if (record) yield record;
    }
  }

  return {
    header: {
      site: headerBundle.site,
      authors: headerBundle.authors,
      terms: headerBundle.terms,
    },
    items: { [Symbol.asyncIterator]: iterate },
  };
}

/**
 * Wrap a single `<item>` slice in a minimal envelope so the eager
 * `parseWxr` recognises the structure. We declare the namespaces
 * the parser keys off so a synthetic envelope without them
 * doesn't lose `<dc:creator>` / `<wp:post_id>` / `<content:encoded>`.
 */
function wrapInChannel(itemXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0"` +
    ` xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"` +
    ` xmlns:content="http://purl.org/rss/1.0/modules/content/"` +
    ` xmlns:dc="http://purl.org/dc/elements/1.1/"` +
    ` xmlns:wp="http://wordpress.org/export/1.2/">` +
    `<channel>` +
    `<title></title><link></link><description></description>` +
    `<wp:base_site_url></wp:base_site_url>` +
    `<wp:base_blog_url></wp:base_blog_url>` +
    itemXml +
    `</channel></rss>`
  );
}

