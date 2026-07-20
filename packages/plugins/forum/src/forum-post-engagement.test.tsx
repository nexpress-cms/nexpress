import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForumPostEngagement } from "./client/forum-post-engagement.js";

const initial = {
  targetType: "forum-posts",
  targetId: "00000000-0000-4000-8000-000000000000",
  viewCount: 12,
  commentCount: 3,
  reactionCount: 2,
  reactions: { like: 2 },
};

const labels = {
  views: "조회",
  comments: "댓글",
  reactions: "추천",
  recommend: "추천",
  recommended: "추천 취소",
  failed: "변경 실패",
};

describe("forum post engagement", () => {
  it("renders the server summary and a member-only recommendation control", () => {
    const authenticated = renderToStaticMarkup(
      <ForumPostEngagement
        targetType="forum-posts"
        targetId={initial.targetId}
        initial={initial}
        locale="ko-KR"
        isAuthenticated
        trackViews
        labels={labels}
      />,
    );
    const anonymous = renderToStaticMarkup(
      <ForumPostEngagement
        targetType="forum-posts"
        targetId={initial.targetId}
        initial={initial}
        locale="ko-KR"
        isAuthenticated={false}
        trackViews
        labels={labels}
      />,
    );

    expect(authenticated).toContain('data-np-forum-engagement="post"');
    expect(authenticated).toContain('data-np-forum-metric="views"');
    expect(authenticated).toContain("12");
    expect(authenticated).toContain('aria-pressed="false"');
    expect(anonymous).not.toContain("<button");
  });
});
