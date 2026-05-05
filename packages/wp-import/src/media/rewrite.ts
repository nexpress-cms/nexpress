import type { LexicalRoot } from "../convert/html-to-lexical.js";
import type { MediaResolution } from "./pipeline.js";

/**
 * Phase 21.5 — replace WP source URLs in a Lexical document with
 * NexPress media references.
 *
 * We patch two things on each `image` node:
 *
 *   1. `mediaId` — what `extractMediaIds` in
 *      `packages/core/src/media/refs.ts` reads to wire `np_media_refs`
 *      so the document gets blocked from referenced-media deletion.
 *   2. `src` — what the SSR renderer at
 *      `packages/editor/src/render-rich-text.tsx` looks at when
 *      drawing the `<img>`. Setting both keeps the rendered HTML
 *      stable while also routing through the framework's media
 *      tracking. The applier sets `src` to the storage URL that the
 *      media adapter eventually resolves; for now we leave it as the
 *      WP source URL so themes that haven't migrated to media-id
 *      resolution still render something.
 *
 * URLs that aren't in the resolution map (download 404, MIME
 * rejected, etc.) are left untouched. Themes will render those as
 * broken images — same outcome as the design doc §6 prescribes.
 */
export function rewriteLexicalMedia(root: LexicalRoot, resolution: MediaResolution): LexicalRoot {
  if (resolution.byUrl.size === 0) {
    return root;
  }
  // Deep-clone so the input remains pure. The Lexical document is
  // small enough that JSON round-tripping is a non-issue.
  const cloned = JSON.parse(JSON.stringify(root)) as LexicalRoot;
  walk(cloned.root as unknown as Record<string, unknown>, resolution);
  return cloned;
}

function walk(node: Record<string, unknown> | null | undefined, resolution: MediaResolution): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "image") {
    const src = typeof node.src === "string" ? node.src : "";
    const mediaId = src ? resolution.byUrl.get(src) : undefined;
    if (mediaId) {
      node.mediaId = mediaId;
    }
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child as Record<string, unknown>, resolution);
  }
}
