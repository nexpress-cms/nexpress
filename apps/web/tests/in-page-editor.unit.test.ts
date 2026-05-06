import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getDefaultBlocks,
  type NpBlockDefinition,
  type NpBlockMetadata,
} from "@nexpress/blocks";

/**
 * Smoke tests for the atom-block additions and metadata extensions
 * landed alongside the in-page editor refresh.
 *
 * No database required — exercises pure block-registry data and
 * server-render output. Lives in `apps/web/tests/` so it picks up
 * the existing vitest config.
 */

const defaults = getDefaultBlocks();
const byType = new Map<string, NpBlockDefinition>(
  defaults.map((d) => [d.type, d]),
);

describe("atom block registration", () => {
  const atomTypes = [
    "paragraph",
    "heading",
    "quote",
    "code",
    "callout",
    "list",
    "image",
    "divider",
  ];

  it.each(atomTypes)("registers %s as a built-in", (type) => {
    const def = byType.get(type);
    expect(def, `expected built-in block "${type}" to be registered`).toBeDefined();
    expect(def?.source).toBe("built-in");
  });

  it("tags every atom with a non-complex docBodyKind", () => {
    for (const type of atomTypes) {
      const def = byType.get(type);
      expect(def?.docBodyKind, `${type} should opt into Doc view`).toBeDefined();
      expect(def?.docBodyKind).not.toBe("complex");
    }
  });

  it("uses Lucide icon names (not emoji) on every atom", () => {
    for (const type of atomTypes) {
      const def = byType.get(type);
      // Lucide names start with an uppercase letter, no emoji
      // codepoints. Use a regex broad enough to permit Heading1
      // (digits in name) but reject `🌅` etc.
      expect(def?.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(def?.iconKind).toBe("lucide");
    }
  });
});

describe("legacy built-in blocks migrated to Lucide", () => {
  const legacyTypes = [
    "hero",
    "feature-grid",
    "faq",
    "pricing",
    "cta",
    "rich-text",
    "contact-form",
    "image-gallery",
    "grid",
    "section-header",
    "testimonials",
    "stats-grid",
    "logos-cloud",
    "tabs",
  ];

  it.each(legacyTypes)("%s now ships a Lucide icon name", (type) => {
    const def = byType.get(type);
    expect(def?.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    expect(def?.iconKind).toBe("lucide");
  });

  it("rich-text is the only legacy block tagged docBodyKind=rich-text", () => {
    const tagged = legacyTypes.filter(
      (t) => byType.get(t)?.docBodyKind === "rich-text",
    );
    expect(tagged).toEqual(["rich-text"]);
  });
});

describe("atom block render output", () => {
  it("paragraph renders a <p> with the provided text", () => {
    const def = byType.get("paragraph") as NpBlockDefinition;
    const out = renderToStaticMarkup(def.render({ text: "Hello" }) as never);
    expect(out).toContain("<p");
    expect(out).toContain("Hello");
  });

  it("heading renders the right tag for level 1/2/3", () => {
    const def = byType.get("heading") as NpBlockDefinition;
    expect(
      renderToStaticMarkup(
        def.render({ text: "Title", level: 1 }) as never,
      ),
    ).toContain("<h1");
    expect(
      renderToStaticMarkup(
        def.render({ text: "Section", level: 3 }) as never,
      ),
    ).toContain("<h3");
  });

  it("divider renders an <hr>", () => {
    const def = byType.get("divider") as NpBlockDefinition;
    const out = renderToStaticMarkup(def.render({}) as never);
    expect(out).toContain("<hr");
  });

  it("code preserves the language attribute", () => {
    const def = byType.get("code") as NpBlockDefinition;
    const out = renderToStaticMarkup(
      def.render({ code: "const x = 1;", language: "ts" }) as never,
    );
    expect(out).toContain('data-language="ts"');
    expect(out).toContain("const x = 1;");
  });

  it("callout exposes a tone data attribute", () => {
    const def = byType.get("callout") as NpBlockDefinition;
    const out = renderToStaticMarkup(
      def.render({ text: "Heads up", tone: "warning" }) as never,
    );
    expect(out).toContain('data-tone="warning"');
  });

  it("list switches between ul and ol via the ordered prop", () => {
    const def = byType.get("list") as NpBlockDefinition;
    const ul = renderToStaticMarkup(
      def.render({ items: ["a", "b"], ordered: false }) as never,
    );
    const ol = renderToStaticMarkup(
      def.render({ items: ["a", "b"], ordered: true }) as never,
    );
    expect(ul).toMatch(/^<ul/);
    expect(ol).toMatch(/^<ol/);
  });
});

describe("metadata invariants", () => {
  it("every atom block exposes a propsSchema", () => {
    const atoms: NpBlockMetadata[] = defaults.filter(
      (d) =>
        d.docBodyKind && d.docBodyKind !== "complex" && d.docBodyKind !== "rich-text",
    );
    for (const meta of atoms) {
      expect(Array.isArray(meta.propsSchema)).toBe(true);
    }
  });

  it("no built-in block carries an emoji icon after the migration", () => {
    for (const def of defaults) {
      if (def.iconKind === "emoji") continue; // Plugin escape hatch
      // Lucide names + Latin alphanumeric only.
      expect(def.icon ?? "").toMatch(/^([A-Z][A-Za-z0-9]*)?$/);
    }
  });
});
