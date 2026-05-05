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
export function PageCoverTemplate({ doc }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title ?? "";
  const cover = (doc as { coverImage?: unknown }).coverImage;
  const coverUrl =
    typeof cover === "string"
      ? cover
      : typeof cover === "object" &&
          cover !== null &&
          typeof (cover as { url?: unknown }).url === "string"
        ? ((cover as { url: string }).url)
        : null;

  return (
    <article className="nx-magazine-cover">
      <div
        className="nx-magazine-cover-hero"
        style={
          coverUrl ? { backgroundImage: `url(${JSON.stringify(coverUrl)})` } : undefined
        }
      >
        <h1 className="nx-magazine-cover-title">{title || "Untitled"}</h1>
      </div>
      <div className="nx-magazine-cover-body">
        {blocks ? renderBlocks(blocks) : null}
      </div>
    </article>
  );
}
