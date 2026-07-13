import { afterEach, describe, expect, it, vi } from "vitest";

import { npReadJobDurationMs, npRequireJobDurationMs } from "./runtime-config.js";

describe("job runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads exact positive integer durations", () => {
    vi.stubEnv("NP_TEST_JOB_SECONDS", "30");
    expect(npReadJobDurationMs("NP_TEST_JOB_SECONDS", 90, 1_000)).toBe(30_000);
  });

  it("rejects malformed, zero, and unsafe durations", () => {
    vi.stubEnv("NP_TEST_JOB_SECONDS", "30seconds");
    expect(() => npReadJobDurationMs("NP_TEST_JOB_SECONDS", 90, 1_000)).toThrow(
      "must be a positive integer",
    );
    vi.stubEnv("NP_TEST_JOB_SECONDS", "0");
    expect(() => npReadJobDurationMs("NP_TEST_JOB_SECONDS", 90, 1_000)).toThrow(
      "must be a positive integer",
    );
    expect(() => npRequireJobDurationMs(Number.NaN, "interval")).toThrow(
      "must be a positive safe integer",
    );
  });
});
