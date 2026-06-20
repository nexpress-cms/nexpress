import { describe, expect, it } from "vitest";

import {
  formatStringArrayValue,
  getStringArrayRows,
  normalizeStringArrayValue,
  parseStringArrayDraft,
} from "./string-array.js";

describe("string-array form helpers", () => {
  it("keeps only string array values", () => {
    expect(normalizeStringArrayValue(["read", 1, "write", null])).toEqual(["read", "write"]);
    expect(normalizeStringArrayValue("read")).toEqual([]);
  });

  it("formats values one item per line", () => {
    expect(formatStringArrayValue(["read:user", "user:email"])).toBe("read:user\nuser:email");
  });

  it("parses textarea drafts by trimming and dropping empty lines", () => {
    expect(parseStringArrayDraft(" read:user \r\n\n user:email\n ")).toEqual([
      "read:user",
      "user:email",
    ]);
  });

  it("sizes rows from saved values or live drafts with min and max bounds", () => {
    expect(getStringArrayRows(["read"], null)).toBe(3);
    expect(getStringArrayRows(["a", "b", "c"], null)).toBe(4);
    expect(getStringArrayRows([], "a\nb\nc\nd")).toBe(5);
    expect(
      getStringArrayRows(
        Array.from({ length: 50 }, (_, i) => `scope:${i}`),
        null,
      ),
    ).toBe(12);
  });
});
