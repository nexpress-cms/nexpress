import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Cover template — full-bleed hero image with the page title
 * overlaid, body content flowing in the standard column below.
 *
 * The hero image source is read from a conventional
 * `coverImage` doc field (`{ url: string }` or string URL).
 * Falls back to a flat-color hero when the page has no cover
 * image, so the template still renders meaningfully on a fresh
 * draft.
 */
export function PageCoverTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title ?? "";
  const cover = (doc as { coverImage?: unknown }).coverImage;
  const coverUrl =
    typeof cover === "string"
      ? cover
      : typeof cover === "object" &&
          cover !== null &&
          typeof (cover as { url?: unknown }).url === "string"
        ? (cover as { url: string }).url
        : null;

  return (
    <article className="np-magazine-cover">
      <div
        className="np-magazine-cover-hero"
        style={coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : undefined}
      >
        <h1 className="np-magazine-cover-title">{title || "Untitled"}</h1>
      </div>
      <div className="np-magazine-cover-body">
        {blocks ? renderBlocks(blocks, { ctx: blockCtx }) : null}
      </div>
    </article>
  );
}
