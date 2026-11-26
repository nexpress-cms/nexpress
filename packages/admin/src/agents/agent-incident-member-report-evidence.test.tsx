import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NpAgentIncidentMemberReviewContextV1 } from "@nexpress/core/agent-contract";
import { IncidentMemberReviewContext } from "./agent-incident-member-report-evidence.js";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch,
  }: {
    href: string;
    children: React.ReactNode;
    prefetch: boolean;
  }) => (
    <a href={href} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}));

const memberId = "30000000-0000-4000-8000-000000000003";
const context: NpAgentIncidentMemberReviewContextV1 = {
  siteId: "default",
  snapshotAt: "2026-10-15T00:00:00.000Z",
  activeRestrictions: [
    {
      scopeType: "collection",
      scopeId: "posts",
      kind: "temporary",
      expiresAt: "2026-10-16T00:00:00.000Z",
    },
  ],
  hasMoreRestrictions: false,
  canOpenMemberManagement: true,
};

describe("Member report review context", () => {
  it("shows current scoped expiry and an explicit existing management link without actions", () => {
    const html = renderToStaticMarkup(
      <IncidentMemberReviewContext memberId={memberId} context={context} />,
    );
    expect(html).toContain("collection — posts");
    expect(html).toContain(`dateTime="${context.activeRestrictions[0].expiresAt}"`);
    expect(html).toContain(`href="/admin/members/${memberId}"`);
    expect(html).toContain('data-prefetch="false"');
    expect(html).toContain("Open member management");
    expect(html).toContain("does not establish prior restrictions, revocation or expiry history");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("withholds navigation on access loss and distinguishes missing, empty and incomplete facts", () => {
    const denied = renderToStaticMarkup(
      <IncidentMemberReviewContext
        memberId={memberId}
        context={{ ...context, activeRestrictions: [], canOpenMemberManagement: false }}
      />,
    );
    expect(denied).toContain("No active restrictions were found on this site");
    expect(denied).toContain("unavailable with your current permissions");
    expect(denied).not.toContain("href=");
    const absent = renderToStaticMarkup(<IncidentMemberReviewContext memberId={memberId} />);
    expect(absent).toContain("restrictions and member management access are unavailable");
    expect(absent).not.toContain("No active restrictions");
    const partial = renderToStaticMarkup(
      <IncidentMemberReviewContext
        memberId={memberId}
        context={{ ...context, hasMoreRestrictions: true }}
      />,
    );
    expect(partial).toContain("This list is incomplete");
  });
});
