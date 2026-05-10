import { describe, expect, it } from "vitest";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { canAcceptChild } from "./contracts.js";

const baseDef = (overrides: Partial<NpBlockMetadata>): NpBlockMetadata => ({
  type: "container",
  label: "Container",
  defaultProps: {},
  propsSchema: [],
  acceptsChildren: true,
  ...overrides,
});

describe("canAcceptChild", () => {
  it("accepts any child when no allowedChildTypes is set", () => {
    const def = baseDef({});
    expect(canAcceptChild(def, "anything", 0)).toBe(true);
    expect(canAcceptChild(def, "any-type", 5)).toBe(true);
  });

  it("accepts any child when allowedChildTypes is empty", () => {
    const def = baseDef({ allowedChildTypes: [] });
    expect(canAcceptChild(def, "anything", 0)).toBe(true);
  });

  it("accepts any child when allowedChildTypes contains the wildcard `*`", () => {
    const def = baseDef({ allowedChildTypes: ["*"] });
    expect(canAcceptChild(def, "any-type", 0)).toBe(true);
    // Wildcard wins even if specific types are listed alongside.
    const mixed = baseDef({ allowedChildTypes: ["heading", "*"] });
    expect(canAcceptChild(mixed, "anything", 0)).toBe(true);
  });

  it("restricts children to the listed types when allowedChildTypes is set", () => {
    const def = baseDef({ allowedChildTypes: ["heading", "paragraph"] });
    expect(canAcceptChild(def, "heading", 0)).toBe(true);
    expect(canAcceptChild(def, "paragraph", 0)).toBe(true);
    expect(canAcceptChild(def, "image", 0)).toBe(false);
  });

  it("rejects when the parent is at maxChildren regardless of type", () => {
    const def = baseDef({ maxChildren: 3 });
    expect(canAcceptChild(def, "anything", 2)).toBe(true);
    expect(canAcceptChild(def, "anything", 3)).toBe(false);
    expect(canAcceptChild(def, "anything", 4)).toBe(false);
  });

  it("treats maxChildren=0 as 'no children allowed'", () => {
    const def = baseDef({ maxChildren: 0 });
    expect(canAcceptChild(def, "anything", 0)).toBe(false);
  });

  it("combines allowedChildTypes + maxChildren — both must pass", () => {
    const def = baseDef({
      allowedChildTypes: ["heading"],
      maxChildren: 2,
    });
    expect(canAcceptChild(def, "heading", 0)).toBe(true);
    expect(canAcceptChild(def, "heading", 1)).toBe(true);
    // At cap → reject even allowed types.
    expect(canAcceptChild(def, "heading", 2)).toBe(false);
    // Wrong type → reject even when not at cap.
    expect(canAcceptChild(def, "image", 0)).toBe(false);
  });
});
