import { describe, expect, it } from "vitest";

import { isNpBlockContent, npValidateBlockContent, type NpBlockContent } from "./block-content.js";

const validContent = (): NpBlockContent => [
  {
    id: "hero-1",
    type: "acme.hero",
    props: { title: "Hello", columns: 3, flags: [true, null] },
    children: [{ id: "copy-1", type: "rich-text", props: {} }],
  },
];

describe("block content v1 contract", () => {
  it("accepts an empty list and nested JSON-safe block instances", () => {
    expect(npValidateBlockContent([])).toEqual({ ok: true, value: [] });
    expect(isNpBlockContent(validContent())).toBe(true);
  });

  it.each([
    [null, "must be an array"],
    [[{ id: "one", type: "hero", props: {}, extra: true }], "unsupported field"],
    [[{ id: "bad/id", type: "hero", props: {} }], ".id must start"],
    [[{ id: "one", type: "bad/type", props: {} }], ".type must start"],
    [[{ id: "one", type: "hero", props: [] }], ".props must be an object"],
    [[{ id: "one", type: "hero", props: { score: Infinity } }], "finite number"],
    [[{ id: "one", type: "hero", props: { missing: undefined } }], "only JSON values"],
    [[{ id: "one", type: "hero", props: {}, children: {} }], ".children must be an array"],
  ])("rejects malformed content %#", (value, message) => {
    const result = npValidateBlockContent(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it("rejects duplicate ids across the entire tree", () => {
    const value = validContent();
    value.push({
      id: "copy-1",
      type: "callout",
      props: {},
      children: [],
    });
    const result = npValidateBlockContent(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicates block id "copy-1"');
  });

  it("rejects circular props and block trees", () => {
    const props: Record<string, unknown> = {};
    props.self = props;
    expect(npValidateBlockContent([{ id: "one", type: "hero", props }]).ok).toBe(false);

    const block: Record<string, unknown> = { id: "one", type: "grid", props: {} };
    block.children = [block];
    const result = npValidateBlockContent([block]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("circular block tree");
  });
});
