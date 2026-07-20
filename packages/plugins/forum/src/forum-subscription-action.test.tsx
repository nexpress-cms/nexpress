import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForumSubscriptionAction } from "./client/forum-subscription-action.js";

const labels = {
  subscribe: "게시글 구독",
  subscribed: "게시글 구독 중",
  loading: "구독 상태 확인 중…",
  signIn: "로그인 후 구독",
  failed: "구독 실패",
};

describe("ForumSubscriptionAction", () => {
  it("renders a destination-preserving login action for anonymous readers", () => {
    const html = renderToStaticMarkup(
      <ForumSubscriptionAction
        targetType="forum-posts"
        targetId="11111111-1111-4111-8111-111111111111"
        isAuthenticated={false}
        loginHref="/members/login?next=%2Fboards%2Ffree%2Fpost"
        labels={labels}
      />,
    );
    expect(html).toContain('data-np-forum-subscription="signed-out"');
    expect(html).toContain("/members/login?next=%2Fboards%2Ffree%2Fpost");
    expect(html).toContain("로그인 후 구독");
  });

  it("exposes a disabled loading state until the exact API probe completes", () => {
    const html = renderToStaticMarkup(
      <ForumSubscriptionAction
        targetType="forum-posts"
        targetId="11111111-1111-4111-8111-111111111111"
        isAuthenticated
        loginHref="/members/login"
        labels={labels}
      />,
    );
    expect(html).toContain('data-np-forum-subscription="available"');
    expect(html).toContain("disabled");
    expect(html).toContain("구독 상태 확인 중…");
  });
});
