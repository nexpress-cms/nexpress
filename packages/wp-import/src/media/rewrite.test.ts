import { describe, expect, it } from "vitest";

import { htmlToLexical } from "../convert/html-to-lexical.js";
import { rewriteLexicalMedia } from "./rewrite.js";
import type { MediaResolution } from "./pipeline.js";

function resolution(entries: Array<[string, string]> = []): MediaResolution {
  return {
    byUrl: new Map(entries),
    byAttachmentId: new Map(),
  };
}

describe("rewriteLexicalMedia", () => {
  it("returns the input unchanged when the resolution map is empty", () => {
    const root = htmlToLexical('<p>x <img src="https://a/b.jpg" /></p>');
    const out = rewriteLexicalMedia(root, resolution());
    expect(out).toBe(root); // identity, no clone, no patch
  });

  it("stamps mediaId on the matching image node", () => {
    const root = htmlToLexical('<p>before <img src="https://a/b.jpg" alt="a"/> after</p>');
    const out = rewriteLexicalMedia(root, resolution([["https://a/b.jpg", "media-7"]]));
    const para = out.document.root.children[0];
    const img = para?.children?.find((c) => c.type === "image") as unknown as
      Record<string, unknown> | undefined;
    expect(img?.mediaId).toBe("media-7");
    expect(img?.src).toBe("https://a/b.jpg"); // original src preserved for SSR fallback
  });

  it("does not mutate the input root", () => {
    const root = htmlToLexical('<img src="https://a/b.jpg" />');
    const before = JSON.stringify(root);
    rewriteLexicalMedia(root, resolution([["https://a/b.jpg", "media-1"]]));
    expect(JSON.stringify(root)).toBe(before);
  });

  it("leaves images whose URL isn't in the map untouched", () => {
    const root = htmlToLexical(
      '<img src="https://a/known.jpg" /><img src="https://a/unknown.jpg" />',
    );
    const out = rewriteLexicalMedia(root, resolution([["https://a/known.jpg", "media-1"]]));
    const known = out.document.root.children[0] as unknown as Record<string, unknown>;
    const unknown = out.document.root.children[1] as unknown as Record<string, unknown>;
    expect(known.mediaId).toBe("media-1");
    expect(unknown.mediaId).toBeUndefined();
  });
});
