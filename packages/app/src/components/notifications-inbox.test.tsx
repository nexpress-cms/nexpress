import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import { NotificationsInbox, type NotificationInboxItem } from "./notifications-inbox.js";

vi.stubGlobal("React", { createElement, Fragment });
afterAll(() => vi.unstubAllGlobals());

const base = {
  memberId: "11111111-1111-4111-8111-111111111111",
  readAt: null,
  siteId: "default",
  createdAt: "2026-07-20T00:00:00.000Z",
} satisfies Pick<NotificationInboxItem, "memberId" | "readAt" | "siteId" | "createdAt">;

describe("NotificationsInbox", () => {
  it("renders validated local destinations and drops hostile links", () => {
    const notifications: NotificationInboxItem[] = [
      {
        ...base,
        id: "22222222-2222-4222-8222-222222222222",
        kind: "follow.activity",
        payload: {
          activity: "comment.created",
          subjectType: "forum-posts",
          subjectId: "33333333-3333-4333-8333-333333333333",
          targetType: "forum-posts",
          targetId: "33333333-3333-4333-8333-333333333333",
          href: "/boards/free/33333333-3333-4333-8333-333333333333",
          commentId: "44444444-4444-4444-8444-444444444444",
        },
      },
      {
        ...base,
        id: "55555555-5555-4555-8555-555555555555",
        kind: "plugin.event",
        payload: { href: "https://evil.example/phish" },
      },
    ];

    const html = renderToStaticMarkup(
      <NotificationsInbox initialNotifications={notifications} initialUnread={2} totalDocs={2} />,
    );

    expect(html).toContain('href="/boards/free/33333333-3333-4333-8333-333333333333"');
    expect(html).not.toContain("evil.example");
    expect(html.match(/>View<\/a>/gu)).toHaveLength(1);
  });
});
