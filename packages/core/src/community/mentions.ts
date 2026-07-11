import { inArray } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import { isNpRichTextContent } from "../fields/rich-text.js";

import { createNotification } from "./notifications.js";

/**
 * Phase 16.2 — @mention extraction + notification fan-out.
 *
 * The mention vocabulary mirrors the handle constraint enforced
 * during registration (`/^[a-z0-9][a-z0-9_-]{2,29}$/`). The matcher
 * uses a negative lookbehind so `email@host.com` doesn't trigger a
 * mention, plus a negative lookahead so `@alice-` (handle followed
 * by a hyphen that's not part of the handle) is rejected — handles
 * end at non-handle characters, never mid-symbol.
 *
 * Fan-out semantics:
 *  - Self-mentions are skipped (the author already knows).
 *  - Caller-supplied `exclude` set lets the comment write path
 *    skip the parent author so they don't get both `comment.reply`
 *    AND `comment.mention`.
 *  - Caller-supplied `previousHandles` lets the edit path only
 *    notify newly-added mentions (otherwise toggling a single
 *    other word in a comment would re-notify everyone).
 *  - Inactive / banned / deleted members are filtered out at
 *    resolve time.
 *  - Mute is enforced inside `createNotification` (the
 *    recipient's mute list drops actor-keyed notifications).
 */

/** Source-of-truth handle pattern, kept in sync with `apps/web` register routes. */
export const MENTION_HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

const MENTION_PATTERN = /(?<![A-Za-z0-9_])@([a-z0-9][a-z0-9_-]{2,29})(?![A-Za-z0-9_-])/g;

export interface NpMentionTarget {
  id: string;
  handle: string;
}

/**
 * Extract unique mention handles from plain text or markdown source.
 * Order is preserved (first appearance wins) so a UI that wants to
 * display "you mentioned @alice and @bob" gets the same order as
 * the body text.
 */
export function extractMentionHandles(source: string): string[] {
  if (!source) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of source.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

/**
 * Walk a Lexical-shaped rich-text payload, concatenate its text
 * nodes, and run the mention extractor over the joined result.
 * Mirrors the search-index walker (`collections/search.ts`) so a
 * mention split across two adjacent text spans (e.g. `@` and
 * `alice` in different runs because of formatting toggles) still
 * resolves correctly — text nodes are joined without separators.
 */
export function extractMentionHandlesFromRichText(content: unknown): string[] {
  if (!isNpRichTextContent(content)) return [];
  const parts: string[] = [];
  walkRichTextNodes(content.document.root.children, parts);
  return extractMentionHandles(parts.join(""));
}

function walkRichTextNodes(nodes: unknown[], parts: string[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.children)) walkRichTextNodes(n.children, parts);
  }
}

/**
 * Scan a collection-document data payload (the same shape passed
 * to `createMemberDocument` / `updateMemberDocument`) and pull
 * out every mention handle it contains. String values are scanned
 * with the markdown extractor; object values shaped like Lexical
 * v1 rich text (`{ version: 1, document: { root: ... } }`) values are walked. Other
 * values are ignored.
 *
 * Field names are not assumed: any string or rich-text field
 * contributes. The mention pattern is anchored to `@<handle>`
 * with handle-shape constraints, so unrelated string fields
 * (`category: "news"`) won't trigger false positives.
 */
export function extractMentionHandlesFromDocData(data: Record<string, unknown>): string[] {
  if (!data || typeof data !== "object") return [];
  const seen = new Set<string>();
  for (const value of Object.values(data)) {
    if (typeof value === "string") {
      for (const h of extractMentionHandles(value)) seen.add(h);
      continue;
    }
    if (isNpRichTextContent(value)) {
      for (const h of extractMentionHandlesFromRichText(value)) seen.add(h);
    }
  }
  return Array.from(seen);
}

/**
 * Resolve handles to active member ids. Inactive / banned /
 * deleted members are filtered out so a mention of an account
 * the site no longer wants to notify is silently dropped (rather
 * than raising an error to the writer — the writer can't tell the
 * difference between "typo" and "account closed", and either way
 * the right behaviour is "no notification").
 *
 * Lookups are case-insensitive on the handle (the storage column
 * stores the canonical lowercased form).
 */
export async function resolveMentionedMembers(handles: string[]): Promise<NpMentionTarget[]> {
  if (handles.length === 0) return [];
  const lower = Array.from(new Set(handles.map((h) => h.toLowerCase())));
  const db = getDb();
  const rows = (await db
    .select({ id: npMembers.id, handle: npMembers.handle, status: npMembers.status })
    .from(npMembers)
    .where(inArray(npMembers.handle, lower))) as Array<{
    id: string;
    handle: string;
    status: string;
  }>;
  return rows.filter((r) => r.status === "active").map((r) => ({ id: r.id, handle: r.handle }));
}

export interface FanOutMentionsInput {
  /** The author whose write triggered the fan-out. Self-mentions are skipped. */
  actorMemberId: string;
  /** Notification `kind` (e.g. `"comment.mention"`, `"discussion.mention"`). */
  kind: string;
  /**
   * Plain text or markdown to scan. Either `source` or `content`
   * (or both) must be provided; if both are set the handles are
   * unioned.
   */
  source?: string;
  /** Lexical-shaped rich-text JSON to scan. */
  content?: unknown;
  /**
   * Collection-document data payload to scan. All string +
   * rich-text fields contribute. Useful for the
   * `createMemberDocument` / `updateMemberDocument` paths.
   */
  data?: Record<string, unknown>;
  /**
   * Recipients that already received a notification for this same
   * event (e.g. the parent author got `comment.reply`). They are
   * skipped to avoid the "two pings for one comment" pattern.
   */
  exclude?: ReadonlySet<string>;
  /** Merged into the notification payload. `mentionedMemberId` is added automatically. */
  payload?: Record<string, unknown>;
  /**
   * Edit path: handles that were present in the prior revision
   * are skipped so toggling unrelated words doesn't re-notify
   * everyone already mentioned.
   */
  previousHandles?: ReadonlySet<string>;
}

/**
 * Fan-out mention notifications. Returns the number of
 * notifications actually inserted (mute / inactive / self / dedup
 * exclusions all reduce the count).
 */
export async function fanOutMentionNotifications(input: FanOutMentionsInput): Promise<number> {
  const handles = new Set<string>();
  if (input.source) {
    for (const h of extractMentionHandles(input.source)) handles.add(h);
  }
  if (input.content !== undefined) {
    for (const h of extractMentionHandlesFromRichText(input.content)) handles.add(h);
  }
  if (input.data) {
    for (const h of extractMentionHandlesFromDocData(input.data)) handles.add(h);
  }
  if (input.previousHandles) {
    for (const prev of input.previousHandles) handles.delete(prev);
  }
  if (handles.size === 0) return 0;

  const targets = await resolveMentionedMembers(Array.from(handles));
  let fired = 0;
  for (const t of targets) {
    if (t.id === input.actorMemberId) continue;
    if (input.exclude?.has(t.id)) continue;
    const row = await createNotification({
      memberId: t.id,
      kind: input.kind,
      actorMemberId: input.actorMemberId,
      payload: {
        ...(input.payload ?? {}),
        mentionedMemberId: t.id,
        mentionedHandle: t.handle,
      },
    });
    if (row) fired += 1;
  }
  return fired;
}
