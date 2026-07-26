import { describe, expect, it } from "vitest";

import { commandForHealthCheck, relatedLinksForHealthCheck } from "./admin-ops.js";

describe("community realtime admin ops routing", () => {
  it("routes retention warnings to job evidence and remediation", () => {
    expect(
      commandForHealthCheck({
        id: "community.realtime_retention",
        label: "Community realtime retention",
        state: "warn",
      }),
    ).toBe("pnpm --silent run ops:jobs -- status --json");
    expect(relatedLinksForHealthCheck("community.realtime_retention")).toEqual([
      { label: "Jobs", href: "/admin/jobs" },
      { label: "Health", href: "/admin/health" },
    ]);
  });
});
