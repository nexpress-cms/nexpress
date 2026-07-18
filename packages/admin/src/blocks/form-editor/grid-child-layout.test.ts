import { describe, expect, it } from "vitest";

import { updateGridChildLayout } from "./grid-child-layout.js";

describe("updateGridChildLayout", () => {
  it("sets responsive spans without storing the full-width default", () => {
    expect(updateGridChildLayout(undefined, "base", 6)).toEqual({ colSpan: 6 });
    expect(updateGridChildLayout({ colSpan: 6 }, "md", 4)).toEqual({
      colSpan: 6,
      mdColSpan: 4,
    });
    expect(updateGridChildLayout({ colSpan: 12 }, "base", 12)).toBeUndefined();
    expect(updateGridChildLayout(undefined, "base", 6, 6)).toBeUndefined();
  });

  it("removes optional overrides while preserving the remaining layout", () => {
    expect(updateGridChildLayout({ colSpan: 12, mdColSpan: 8, lgColSpan: 6 }, "lg", null)).toEqual({
      colSpan: 12,
      mdColSpan: 8,
    });
    expect(updateGridChildLayout({ colSpan: 12, mdColSpan: 8 }, "md", null)).toBeUndefined();
  });
});
