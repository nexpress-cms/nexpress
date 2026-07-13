import { describe, expect, it } from "vitest";

import { createRevisionHelpers } from "./revisions.js";

describe("revision helpers", () => {
  const helpers = createRevisionHelpers({ ensureReady() {} });

  it("accepts the documented list bounds", () => {
    expect(helpers.parseRevisionListOptions(new URLSearchParams("limit=1&offset=0"))).toEqual({
      limit: 1,
      offset: 0,
    });
    expect(helpers.parseRevisionListOptions(new URLSearchParams("limit=100&offset=4"))).toEqual({
      limit: 100,
      offset: 4,
    });
  });

  it.each(["0", "-1", "1.5", "101", "NaN"])("rejects invalid limits (%s)", (limit) => {
    expect(() => helpers.parseRevisionListOptions(new URLSearchParams({ limit }))).toThrow(
      "Invalid query parameters",
    );
  });

  it.each(["-1", "1.5", "NaN"])("rejects invalid offsets (%s)", (offset) => {
    expect(() => helpers.parseRevisionListOptions(new URLSearchParams({ offset }))).toThrow(
      "Invalid query parameters",
    );
  });
});
