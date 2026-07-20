import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { NpThemeMemberProfileProps } from "@nexpress/theme";
import { CommunityMemberProfile } from "./member-profile.js";

vi.stubGlobal("React", { createElement, Fragment });
afterAll(() => vi.unstubAllGlobals());

describe("CommunityMemberProfile", () => {
  it("renders comment activity without importing the forum plugin", () => {
    const props: NpThemeMemberProfileProps = {
      profile: {
        id: "11111111-1111-4111-8111-111111111111",
        handle: "alice",
        displayName: "Alice",
        avatarUrl: null,
        bio: null,
        reputation: 3,
        joinedAt: "2026-07-20T00:00:00.000Z",
      },
      activity: {
        kind: "comments",
        items: [
          {
            kind: "comment",
            commentId: "22222222-2222-4222-8222-222222222222",
            targetType: "posts",
            targetId: "33333333-3333-4333-8333-333333333333",
            targetTitle: "A post",
            href: "/blog/a-post#comment-22222222-2222-4222-8222-222222222222",
            excerpt: "A useful comment",
            createdAt: "2026-07-20T00:00:00.000Z",
            editedAt: null,
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 20,
        hasNextPage: false,
        hasPrevPage: false,
      },
      followAction: null,
      locale: "en",
      links: {
        documents: "/u/alice",
        comments: "/u/alice?activity=comments",
        previous: null,
        next: null,
      },
      labels: {
        member: "Community member",
        comment: "Comment",
        documents: "Posts",
        comments: "Comments",
        emptyBio: "No bio",
        emptyDocuments: "No posts",
        emptyComments: "No comments",
        previous: "Previous",
        next: "Next",
        memberSince: "Member since",
        reputation: "Reputation",
        activityNavigation: "Member activity",
        paginationNavigation: "Activity pagination",
      },
    };
    const html = renderToStaticMarkup(<CommunityMemberProfile {...props} />);
    expect(html).toContain('data-np-community-member-profile="alice"');
    expect(html).toContain('data-np-member-activity="comments"');
    expect(html).toContain("A useful comment");
    expect(html).toContain("#comment-22222222-2222-4222-8222-222222222222");
  });
});
