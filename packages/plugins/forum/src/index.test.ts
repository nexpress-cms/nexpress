import { describe, expect, it } from "vitest";

import { forumPlugin } from "./index.js";

describe("forum plugin", () => {
  it("declares the admin action id and kind inventory", () => {
    expect(
      Object.entries(forumPlugin.actions ?? {}).map(([id, action]) => ({
        id,
        kind: action.kind,
      })),
    ).toEqual([{ id: "countDiscussions", kind: "metric" }]);
  });
});
