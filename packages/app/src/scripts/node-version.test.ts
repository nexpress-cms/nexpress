import { describe, expect, it } from "vitest";

import {
  NP_MINIMUM_NODE_ENGINE,
  NP_MINIMUM_NODE_VERSION,
  npIsSupportedNodeVersion,
} from "./node-version.js";

describe("Node runtime contract", () => {
  it("publishes one exact minimum version and engine range", () => {
    expect(NP_MINIMUM_NODE_VERSION).toBe("20.19.0");
    expect(NP_MINIMUM_NODE_ENGINE).toBe(">=20.19.0");
  });

  it.each([
    ["20.18.3", false],
    ["v20.19.0", true],
    ["20.19.1", true],
    ["21.0.0", true],
    ["22.0.0", true],
    ["20.19", false],
    ["not-a-version", false],
  ])("classifies %s", (version, supported) => {
    expect(npIsSupportedNodeVersion(version)).toBe(supported);
  });
});
