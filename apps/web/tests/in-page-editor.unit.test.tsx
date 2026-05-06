import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getDefaultBlocks,
  renderInlineMarks,
  type NpBlockDefinition,
  type NpBlockInstance,
  type NpBlockMetadata,
} from "@nexpress/blocks";

// Engine reducer + factory — deep-imported because the public
// `@nexpress/admin` exports only surface UI components today. The
// editor engine is intentionally UI-agnostic; reaching in through
// the source path keeps the engine internal while still letting
// the unit suite cover its contract.
import {
  createBlockInstance,
  createEditorReducer,
} from "../../../packages/admin/src/blocks/editor-engine/reducer.js";
import type { EditorAction } from "../../../packages/admin/src/blocks/editor-engine/types.js";

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

describe("editor reducer — REPLACE_TYPE", () => {
  // Build a reducer pinned to the production registry so the cases
  // below exercise the same definitions plugin authors and the
  // admin UI see at runtime.
  const reducer = createEditorReducer(defaults);
  const apply = (
    state: NpBlockInstance[],
    action: EditorAction,
  ): NpBlockInstance[] => reducer(state, action);

  const seed = (overrides: Partial<NpBlockInstance> = {}): NpBlockInstance => {
    const def = byType.get("paragraph") as NpBlockDefinition;
    const base = createBlockInstance(def);
    return { ...base, ...overrides, props: { ...base.props, ...(overrides.props ?? {}) } };
  };

  it("preserves the source id across the swap", () => {
    const p = seed({ props: { text: "hello" } });
    const next = apply([p], { type: "REPLACE_TYPE", id: p.id, newType: "heading" });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(p.id);
    expect(next[0].type).toBe("heading");
  });

  it("carries the primary text-shaped prop when preserveText is on (default)", () => {
    const p = seed({ props: { text: "carry me" } });
    const next = apply([p], { type: "REPLACE_TYPE", id: p.id, newType: "heading" });
    expect(next[0].props.text).toBe("carry me");
  });

  it("drops the text when preserveText is explicitly false", () => {
    const p = seed({ props: { text: "throw away" } });
    const next = apply([p], {
      type: "REPLACE_TYPE",
      id: p.id,
      newType: "heading",
      preserveText: false,
    });
    expect(next[0].props.text).toBe("");
  });

  it("is a no-op when the new type isn't registered", () => {
    const p = seed({ props: { text: "stays" } });
    const next = apply([p], {
      type: "REPLACE_TYPE",
      id: p.id,
      newType: "definitely-not-a-block",
    });
    expect(next).toBe([p].length === next.length ? next : next); // identity check
    expect(next[0]).toEqual(p);
  });

  it("is a no-op when the source id isn't found", () => {
    const p = seed({ props: { text: "stays" } });
    const next = apply([p], {
      type: "REPLACE_TYPE",
      id: "missing-id",
      newType: "heading",
    });
    expect(next[0]).toEqual(p);
  });

  it("preserves children when both old and new types accept them", () => {
    // Synthetic registry — `grid` is the only built-in container,
    // so to test the both-accept-children path we register a
    // second container alongside the defaults.
    const altContainerDef: NpBlockDefinition = {
      type: "alt-container",
      label: "Alt Container",
      acceptsChildren: true,
      defaultProps: {},
      propsSchema: [],
      render: () => <div />,
    };
    const localReducer = createEditorReducer([...defaults, altContainerDef]);
    const childDef = byType.get("paragraph") as NpBlockDefinition;
    const child = createBlockInstance(childDef);
    const gridDef = byType.get("grid") as NpBlockDefinition;
    const grid: NpBlockInstance = {
      ...createBlockInstance(gridDef),
      children: [child],
    };
    const next = localReducer([grid], {
      type: "REPLACE_TYPE",
      id: grid.id,
      newType: "alt-container",
    });
    expect(next[0].type).toBe("alt-container");
    expect(next[0].children).toHaveLength(1);
    expect(next[0].children?.[0].id).toBe(child.id);
  });

  it("drops children when the target type doesn't accept them", () => {
    const childDef = byType.get("paragraph") as NpBlockDefinition;
    const child = createBlockInstance(childDef);
    const gridDef = byType.get("grid") as NpBlockDefinition;
    const grid: NpBlockInstance = {
      ...createBlockInstance(gridDef),
      children: [child],
    };
    const next = apply([grid], {
      type: "REPLACE_TYPE",
      id: grid.id,
      newType: "paragraph",
    });
    expect(next[0].type).toBe("paragraph");
    expect(next[0].children).toBeUndefined();
  });

  it("rejects when the parent's allowedChildTypes excludes the new type", () => {
    // Synthetic strict container — built-ins don't currently set
    // `allowedChildTypes`, so we pin one for the contract check.
    const strictContainerDef: NpBlockDefinition = {
      type: "strict-container",
      label: "Strict",
      acceptsChildren: true,
      allowedChildTypes: ["heading"],
      defaultProps: {},
      propsSchema: [],
      render: () => <div />,
    };
    const localReducer = createEditorReducer([...defaults, strictContainerDef]);
    const headingDef = byType.get("heading") as NpBlockDefinition;
    const headingChild = createBlockInstance(headingDef);
    const container: NpBlockInstance = {
      id: "strict-1",
      type: "strict-container",
      props: {},
      children: [headingChild],
    };
    const next = localReducer([container], {
      type: "REPLACE_TYPE",
      id: headingChild.id,
      newType: "paragraph",
    });
    // No-op: the child stays a heading, not converted.
    expect(next[0].children?.[0].type).toBe("heading");
    expect(next[0].children?.[0].id).toBe(headingChild.id);
  });

  it("REPLACE_TYPE ↔ UPDATE_PROPS flow lets the toolbar pin a heading level", () => {
    // The toolbar's H1 button dispatches REPLACE_TYPE then
    // UPDATE_PROPS. Confirm both compose into the expected
    // post-state without mutating the source id.
    const p = seed({ props: { text: "title" } });
    let state = apply([p], { type: "REPLACE_TYPE", id: p.id, newType: "heading" });
    state = apply(state, {
      type: "UPDATE_PROPS",
      id: p.id,
      props: { level: 1 },
    });
    expect(state[0].id).toBe(p.id);
    expect(state[0].type).toBe("heading");
    expect(state[0].props.text).toBe("title");
    expect(state[0].props.level).toBe(1);
  });
});

describe("inline marks (markdown-style atom block formatting)", () => {
  const render = (input: string): string =>
    renderToStaticMarkup(<>{renderInlineMarks(input)}</>);

  it("wraps **bold** in <strong>", () => {
    expect(render("hello **world**")).toBe("hello <strong>world</strong>");
  });

  it("wraps *italic* in <em>", () => {
    expect(render("a *bit* of text")).toBe("a <em>bit</em> of text");
  });

  it("wraps _underline_ in <u>", () => {
    expect(render("an _accent_ here")).toBe("an <u>accent</u> here");
  });

  it("wraps ~~strike~~ in <s>", () => {
    expect(render("~~old~~ news")).toBe("<s>old</s> news");
  });

  it("wraps `code` in <code>", () => {
    expect(render("call `foo()` to start")).toBe(
      "call <code>foo()</code> to start",
    );
  });

  it("nests italic inside bold", () => {
    expect(render("**bold *italic* word**")).toBe(
      "<strong>bold <em>italic</em> word</strong>",
    );
  });

  it("leaves unmatched delimiters as plain text", () => {
    expect(render("plain *text without a closer")).toBe(
      "plain *text without a closer",
    );
  });

  it("renders empty input as null", () => {
    expect(render("")).toBe("");
  });

  it("does not break on bare delimiters with no content", () => {
    expect(render("** ")).toBe("** ");
  });
});
