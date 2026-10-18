import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { npRequireAgentApprovalGuardianSessionActionReviewV1 } from "@nexpress/core/agent-contract";
import { ApprovalActionFacts } from "./agent-approval-view.js";
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
describe("Guardian signed session approval review", () => {
  it("presents exact session, deployment impact and super-admin requirement without mutation controls", () => {
    const review = npRequireAgentApprovalGuardianSessionActionReviewV1({
      actionId: id,
      proposalHash: hash,
      capabilityId: "security.revokeSessions",
      incidentId: id,
      expectedTargetVersionDigest: hash,
      target: {
        actorKind: "member",
        sessionFamilyId: id,
        createdAt: "2026-10-18T00:00:00.000Z",
        impact: "deployment",
        affectedSiteCount: 2,
        impactDigest: hash,
      },
      policyDigest: hash,
    });
    const html = renderToStaticMarkup(<ApprovalActionFacts review={review} />);
    expect(html).toContain("Revoke this exact browser session");
    expect(html).toContain("Deployment · 2 sites");
    expect(html).toContain("different super administrator");
    expect(html).toContain("cannot be undone");
    expect(html).toContain("Other session families remain valid");
    expect(html).toContain(hash);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Content moderation action");
    expect(html).not.toContain("request restriction action");
  });
});
