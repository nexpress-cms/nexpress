import { describe, expect, it } from "vitest";

import {
  applyBlockXliffUnit,
  createBlockImportBaseline,
  createBlockXliffUnits,
  parseBlockUnitId,
} from "./blocks.js";

function richText(text: string): Record<string, unknown> {
  return {
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [{ type: "text", version: 1, text }],
        },
      ],
    },
  };
}

function sourceBlocks(): Array<Record<string, unknown>> {
  return [
    {
      id: "layout-1",
      type: "grid",
      props: { columns: 12, gap: "2rem" },
      children: [
        {
          id: "hero-1",
          type: "hero",
          props: {
            title: "Welcome",
            subtitle: "Build something useful.",
            ctaText: "Start now",
            ctaUrl: "/start",
            backgroundImage: "/hero.jpg",
          },
        },
        {
          id: "faq-1",
          type: "faq",
          props: {
            heading: "Questions",
            items: [
              { question: "First?", answer: "First answer." },
              { question: "Second?", answer: "Second answer." },
            ],
          },
        },
        {
          id: "rich-1",
          type: "rich-text",
          props: { content: richText("Formatted source") },
        },
      ],
    },
  ];
}

describe("block XLIFF codec", () => {
  it("derives units only from schema-declared translatable props", () => {
    const units = createBlockXliffUnits("blocks", sourceBlocks(), null);
    const descriptors = units.map((unit) => parseBlockUnitId(unit.id)!);

    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockId: "hero-1", path: ["title"] }),
        expect.objectContaining({ blockId: "faq-1", path: ["items", 1, "answer"] }),
        expect.objectContaining({ blockId: "rich-1", path: ["content"] }),
      ]),
    );
    expect(descriptors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockId: "layout-1", path: ["gap"] }),
        expect.objectContaining({ blockId: "hero-1", path: ["ctaUrl"] }),
      ]),
    );
    expect(
      units.find((unit) => parseBlockUnitId(unit.id)?.blockId === "rich-1")?.sourceInline,
    ).toBeDefined();
  });

  it("prefills compatible targets by block id even when nested blocks move", () => {
    const target = sourceBlocks();
    const children = target[0].children as Array<Record<string, unknown>>;
    children.reverse();
    const hero = children.find((block) => block.id === "hero-1")!;
    (hero.props as Record<string, unknown>).title = "환영합니다";

    const units = createBlockXliffUnits("blocks", sourceBlocks(), target);
    const title = units.find((unit) => {
      const descriptor = parseBlockUnitId(unit.id);
      return descriptor?.blockId === "hero-1" && descriptor.path.join(".") === "title";
    });
    expect(title?.target).toBe("환영합니다");
  });

  it("applies atomic and rich-text props while preserving target structure and non-translatable props", () => {
    const source = sourceBlocks();
    const baseline = createBlockImportBaseline(source, null)!;
    const units = createBlockXliffUnits("blocks", source, null);
    const title = units.find((unit) => parseBlockUnitId(unit.id)?.path.join(".") === "title")!;
    title.target = "Bienvenue";
    let result = applyBlockXliffUnit({ sourceValue: source, targetValue: baseline, unit: title });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rich = units.find((unit) => parseBlockUnitId(unit.id)?.blockId === "rich-1")!;
    rich.targetInline = rich.targetInline!.map((part) =>
      part.type === "group" ? { ...part, text: "Contenu formaté" } : part,
    );
    result = applyBlockXliffUnit({ sourceValue: source, targetValue: result.value, unit: rich });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const layout = result.value[0];
    expect(layout.props.gap).toBe("2rem");
    const children = layout.children!;
    const hero = children.find((block) => block.id === "hero-1")!;
    expect(hero.props).toEqual(expect.objectContaining({ title: "Bienvenue", ctaUrl: "/start" }));
    const richBlock = children.find((block) => block.id === "rich-1")!;
    const root = (
      richBlock.props.content as {
        root: { children: Array<{ children: Array<{ text: string }> }> };
      }
    ).root;
    expect(root.children[0].children[0].text).toBe("Contenu formaté");
  });

  it("rejects stale source text, duplicate block ids, and schema path tampering", () => {
    const source = sourceBlocks();
    const unit = createBlockXliffUnits("blocks", source, null).find(
      (candidate) => parseBlockUnitId(candidate.id)?.path.join(".") === "title",
    )!;
    unit.target = "Translated";
    const baseline = createBlockImportBaseline(source, null)!;

    expect(
      applyBlockXliffUnit({
        sourceValue: source,
        targetValue: baseline,
        unit: { ...unit, source: "tampered" },
      }),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("live document") }),
    );

    const duplicated = [...source, structuredClone(source[0])];
    expect(applyBlockXliffUnit({ sourceValue: duplicated, targetValue: duplicated, unit })).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("duplicated") }),
    );

    const descriptor = parseBlockUnitId(unit.id)!;
    const tamperedId = unit.id.replace(
      encodeURIComponent(JSON.stringify(descriptor.path)),
      encodeURIComponent(JSON.stringify(["ctaUrl"])),
    );
    expect(
      applyBlockXliffUnit({
        sourceValue: source,
        targetValue: baseline,
        unit: { ...unit, id: tamperedId },
      }),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("not declared") }),
    );
  });
});
