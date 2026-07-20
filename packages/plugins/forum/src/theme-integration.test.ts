import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("forum theme integration styles", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  it("keeps plugin structure below the active theme layer", () => {
    expect(styles.trimStart().startsWith("@layer np-blocks {")).toBe(true);
    expect(styles).not.toContain("@layer np-theme");
  });

  it("consumes stable optional forum variables with core-token fallbacks", () => {
    for (const property of [
      "--np-forum-content-max",
      "--np-forum-detail-max",
      "--np-forum-composer-max",
      "--np-forum-page-gutter",
      "--np-forum-page-space",
      "--np-forum-panel-background",
      "--np-forum-panel-border",
      "--np-forum-panel-radius",
      "--np-forum-panel-shadow",
      "--np-forum-muted-background",
      "--np-forum-muted-foreground",
      "--np-forum-accent",
      "--np-forum-accent-foreground",
      "--np-forum-row-min-height",
      "--np-forum-row-padding",
      "--np-forum-block-space",
      "--np-forum-block-gap",
      "--np-forum-block-board-min-height",
      "--np-forum-block-card-padding",
      "--np-forum-block-feed-card-min-height",
    ]) {
      expect(styles).toMatch(new RegExp(`var\\(\\s*${property},`, "u"));
    }
    expect(styles).not.toMatch(/^\s*--np-forum-(?!community)[\w-]+\s*:/mu);
  });
});
