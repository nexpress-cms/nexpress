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

  it("routes capacity warnings to live operations evidence", () => {
    expect(
      commandForHealthCheck({
        id: "community.realtime_capacity",
        label: "Community realtime capacity",
        state: "warn",
      }),
    ).toBe("pnpm --silent run ops:status -- --json");
    expect(relatedLinksForHealthCheck("community.realtime_capacity")).toEqual([
      { label: "Health", href: "/admin/health" },
      { label: "Readiness", href: "/admin/readiness" },
    ]);
  });
});

describe("Agent contract admin ops routing", () => {
  it("routes aggregate contract failures to Doctor without exposing row details", () => {
    expect(
      commandForHealthCheck({
        id: "agents.contract",
        label: "Agent contracts",
        state: "error",
      }),
    ).toBe("pnpm run doctor");
    expect(relatedLinksForHealthCheck("agents.contract")).toEqual([
      { label: "Health", href: "/admin/health" },
      { label: "Readiness", href: "/admin/readiness" },
    ]);
  });
});
