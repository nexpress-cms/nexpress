import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { npRequireAgentApprovalGuardianResponseActionReviewV1 } from "@nexpress/core/agent-contract";
import { ApprovalActionFacts } from "./agent-approval-view.js";
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const id = "10000000-0000-4000-8000-000000000001";
const sourceId = "10000000-0000-4000-8000-000000000002";
const hash = `cj1:sha256:${"A".repeat(43)}`;
describe("Guardian human approval review", () => {
  it("renders exact duration/scopes and facts without treating Guardian as Member or content moderation", () => {
    const review = npRequireAgentApprovalGuardianResponseActionReviewV1({
      actionId: id,
      proposalHash: hash,
      capabilityId: "security.limitActor",
      incidentId: id,
      expectedTargetVersionDigest: hash,
      operation: {
        kind: "limit",
        durationSeconds: 600,
        actionScopes: ["auth.member", "auth.staff"],
      },
      policyDigest: hash,
    });
    const html = renderToStaticMarkup(<ApprovalActionFacts review={review} />);
    expect(html).toContain("Temporarily limit requests on this site");
    expect(html).toContain("600 seconds");
    expect(html).toContain("auth.member, auth.staff");
    expect(html).toContain(hash);
    expect(html).toContain("separate explicit request");
    expect(html).not.toContain("Content moderation action");
    expect(html).not.toContain("Member site restriction action");
    expect(html).not.toContain("<button");
    const removal = npRequireAgentApprovalGuardianResponseActionReviewV1({
      ...review,
      capabilityId: "security.removeActorLimit",
      operation: { kind: "remove", sourceActionId: sourceId, restrictionId: id },
    });
    const removed = renderToStaticMarkup(<ApprovalActionFacts review={removal} />);
    expect(removed).toContain("Remove this exact request limit");
    expect(removed).toContain(sourceId);
    expect(removed).toContain(id);
    expect(removed).not.toContain("Request scopes");
  });
});
