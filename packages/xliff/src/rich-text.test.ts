import { describe, expect, it } from "vitest";

import { applyRichTextXliffValue, createRichTextXliffValue } from "./rich-text.js";

function richTextFixture(): Record<string, unknown> {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 1,
              mode: "normal",
              style: "",
              text: "Hello ",
            },
            {
              type: "link",
              version: 1,
              url: "https://example.com/source",
              children: [
                {
                  type: "text",
                  version: 1,
                  detail: 0,
                  format: 2,
                  mode: "normal",
                  style: "",
                  text: "world",
                },
              ],
            },
            { type: "image", version: 1, mediaId: "media-1" },
          ],
        },
        {
          type: "list",
          version: 1,
          listType: "bullet",
          children: [
            {
              type: "listitem",
              version: 1,
              children: [
                {
                  type: "text",
                  version: 1,
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "First",
                },
              ],
            },
            {
              type: "listitem",
              version: 1,
              children: [
                {
                  type: "text",
                  version: 1,
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "Second",
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("Lexical XLIFF inline codec", () => {
  it("assigns deterministic text paths and protected block breaks", () => {
    const value = createRichTextXliffValue(richTextFixture(), null);

    expect(value).not.toBeNull();
    expect(value!.sourceInline).toEqual([
      { type: "group", id: "n-0-0", ctype: "x-nexpress-lexical", text: "Hello " },
      { type: "group", id: "n-0-1-0", ctype: "x-nexpress-lexical", text: "world" },
      { type: "placeholder", id: "b-0", ctype: "lb" },
      { type: "group", id: "n-1-0-0", ctype: "x-nexpress-lexical", text: "First" },
      { type: "placeholder", id: "b-1", ctype: "lb" },
      { type: "group", id: "n-1-1-0", ctype: "x-nexpress-lexical", text: "Second" },
    ]);
    expect(value!.source).toBe("Hello world\nFirst\nSecond");
    expect(value!.targetInline.filter((part) => part.type === "group")).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "" })]),
    );
  });

  it("prefills targets only when the existing Lexical structure is compatible", () => {
    const target = richTextFixture();
    const root = target.root as { children: Array<Record<string, unknown>> };
    const paragraph = root.children[0] as { children: Array<Record<string, unknown>> };
    paragraph.children[0].text = "안녕 ";
    const link = paragraph.children[1] as { children: Array<Record<string, unknown>> };
    link.children[0].text = "세계";

    const compatible = createRichTextXliffValue(richTextFixture(), target);
    expect(compatible!.target).toContain("안녕 세계");

    paragraph.children.push({ type: "text", text: "extra" });
    const incompatible = createRichTextXliffValue(richTextFixture(), target);
    expect(incompatible!.target).toBe("\n\n");
  });

  it("applies translated leaves while preserving target formatting, links, and media nodes", () => {
    const source = richTextFixture();
    const existingTarget = richTextFixture();
    const targetRoot = existingTarget.root as { children: Array<Record<string, unknown>> };
    const targetParagraph = targetRoot.children[0] as {
      children: Array<Record<string, unknown>>;
    };
    targetParagraph.children[0].text = "Existing ";
    targetParagraph.children[0].format = 8;
    const targetLink = targetParagraph.children[1] as {
      url: string;
      children: Array<Record<string, unknown>>;
    };
    targetLink.url = "https://example.com/target";
    targetLink.children[0].text = "link";

    const unit = createRichTextXliffValue(source, existingTarget)!;
    unit.targetInline = unit.targetInline.map((part) => {
      if (part.type !== "group") return part;
      if (part.id === "n-0-0") return { ...part, text: "Bonjour " };
      if (part.id === "n-0-1-0") return { ...part, text: "" };
      if (part.id === "n-1-0-0") return { ...part, text: "Premier" };
      return { ...part, text: "Deuxième" };
    });

    const result = applyRichTextXliffValue({
      sourceValue: source,
      targetValue: existingTarget,
      sourceInline: unit.sourceInline,
      targetInline: unit.targetInline,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const root = result.value.root as { children: Array<Record<string, unknown>> };
    const paragraph = root.children[0] as { children: Array<Record<string, unknown>> };
    expect(paragraph.children[0]).toEqual(expect.objectContaining({ text: "Bonjour ", format: 8 }));
    const link = paragraph.children[1] as { url: string; children: Array<Record<string, unknown>> };
    expect(link.url).toBe("https://example.com/target");
    expect(link.children[0].text).toBe("link");
    expect(paragraph.children[2]).toEqual(
      expect.objectContaining({ type: "image", mediaId: "media-1" }),
    );
    const list = root.children[1] as { children: Array<{ children: Array<{ text: string }> }> };
    expect(list.children[0].children[0].text).toBe("Premier");
    expect(list.children[1].children[0].text).toBe("Deuxième");
  });

  it("rejects tampered source text and reordered target inline codes", () => {
    const source = richTextFixture();
    const unit = createRichTextXliffValue(source, null)!;
    const firstGroup = unit.sourceInline.find((part) => part.type === "group")!;
    const tamperedSource = unit.sourceInline.map((part) =>
      part === firstGroup && part.type === "group" ? { ...part, text: "tampered" } : part,
    );
    const sourceResult = applyRichTextXliffValue({
      sourceValue: source,
      targetValue: null,
      sourceInline: tamperedSource,
      targetInline: unit.targetInline,
    });
    expect(sourceResult).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("source inline text") }),
    );

    const translatedTarget = unit.targetInline.map((part) =>
      part.type === "group" ? { ...part, text: "translated" } : part,
    );
    [translatedTarget[0], translatedTarget[1]] = [translatedTarget[1], translatedTarget[0]];
    const targetResult = applyRichTextXliffValue({
      sourceValue: source,
      targetValue: null,
      sourceInline: unit.sourceInline,
      targetInline: translatedTarget,
    });
    expect(targetResult).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("reordered") }),
    );
  });
});
