import { describe, expect, it } from "vitest";

import { npAssertRefreshLifetime, npReadBoundedPositiveInteger } from "./auth-runtime.js";

describe("auth runtime configuration contract", () => {
  it("accepts bounded canonical integer strings and defaults only missing values", () => {
    expect(npReadBoundedPositiveInteger("TTL", undefined, 10, 100)).toBe(10);
    expect(npReadBoundedPositiveInteger("TTL", "42", 10, 100)).toBe(42);
    expect(npReadBoundedPositiveInteger("TTL", "", 10, 100)).toBe(10);
  });

  it.each(["0", "-1", "1.5", " 2", "2 ", "1e2", "101"])(
    "rejects malformed or out-of-range value %s",
    (value) => {
      expect(() => npReadBoundedPositiveInteger("TTL", value, 10, 100)).toThrow();
    },
  );

  it("requires refresh lifetime to cover the access lifetime", () => {
    expect(() => npAssertRefreshLifetime(100, 100)).not.toThrow();
    expect(() => npAssertRefreshLifetime(101, 100)).toThrow("must not be shorter");
  });
});
