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

  it("renders a bounded Shop restock notification with its option", () => {
    const notification: NotificationInboxItem = {
      ...base,
      id: "66666666-6666-4666-8666-666666666666",
      kind: "shop.product-restocked",
      payload: {
        eventId: "77777777-7777-4777-8777-777777777777",
        href: "/shop/products/mug",
        title: "Mug",
        option: "Blue",
        productId: "88888888-8888-4888-8888-888888888888",
        variantSku: "MUG-BLUE",
        targetType: "shop-products",
        targetId: "88888888-8888-4888-8888-888888888888",
      },
    };

    const html = renderToStaticMarkup(
      <NotificationsInbox initialNotifications={[notification]} initialUnread={1} totalDocs={1} />,
    );

    expect(html).toContain("Back in stock");
    expect(html).toContain("Mug");
    expect(html).toContain("Blue");
    expect(html).toContain('href="/shop/products/mug"');
  });

  it("renders one Shop order update without exposing recipient data", () => {
    const notification: NotificationInboxItem = {
      ...base,
      id: "99999999-9999-4999-8999-999999999999",
      kind: "shop.order-update",
      payload: {
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        eventKind: "fulfillment.shipped",
        orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        href: "/shop/orders/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Order shipped",
      },
    };

    const html = renderToStaticMarkup(
      <NotificationsInbox initialNotifications={[notification]} initialUnread={1} totalDocs={1} />,
    );

    expect(html).toContain("Order update");
    expect(html).toContain("Order shipped");
    expect(html).toContain('href="/shop/orders/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
    expect(html).not.toContain("@example.com");
  });

  it("renders one Shop catalog price drop", () => {
    const notification: NotificationInboxItem = {
      ...base,
      id: "88888888-8888-4888-8888-888888888888",
      kind: "shop.product-price-dropped",
      payload: {
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        href: "/shop/products/mug",
        title: "Mug",
        option: "Blue",
        currency: "KRW",
        previousPriceMinor: 20_000,
        currentPriceMinor: 18_000,
      },
    };
    const html = renderToStaticMarkup(
      <NotificationsInbox initialNotifications={[notification]} initialUnread={1} totalDocs={1} />,
    );
    expect(html).toContain("Price dropped");
    expect(html).toContain("Mug");
    expect(html).toContain('href="/shop/products/mug"');
  });

  it("fails closed over malformed Shop price notification money", () => {
    const notification: NotificationInboxItem = {
      ...base,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "shop.product-price-dropped",
      payload: {
        title: "Mug",
        currency: "NOT-A-CURRENCY",
        currentPriceMinor: -1,
      },
    };
    const html = renderToStaticMarkup(
      <NotificationsInbox initialNotifications={[notification]} initialUnread={1} totalDocs={1} />,
    );
    expect(html).toContain("Mug");
    expect(html).toContain("has a lower catalog price");
  });
});
