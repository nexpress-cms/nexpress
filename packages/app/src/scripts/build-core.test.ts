import { describe, expect, it } from "vitest";

import { findForbiddenBuildWarnings, renderForbiddenBuildWarnings } from "./build-core.js";

describe("build warning guard", () => {
  it("flags Turbopack NFT root-trace warnings", () => {
    const warnings = findForbiddenBuildWarnings(`
      Turbopack build encountered 1 warnings:
      ./apps/web/next.config.ts
      Encountered unexpected file in NFT list
    `);

    expect(warnings.map((warning) => warning.id)).toEqual(["turbopack-nft-root-trace"]);
  });

  it("ignores clean Next build output", () => {
    expect(findForbiddenBuildWarnings("✓ Compiled successfully")).toEqual([]);
  });

  it("renders an actionable error", () => {
    const output = renderForbiddenBuildWarnings(
      findForbiddenBuildWarnings("Encountered unexpected file in NFT list"),
    );

    expect(output).toContain("NexPress build guard blocked");
    expect(output).toContain("turbopack-nft-root-trace");
    expect(output).toContain("runtime file access");
  });
});
