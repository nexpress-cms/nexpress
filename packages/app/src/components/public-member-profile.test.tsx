import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { NpThemeMemberProfileProps } from "@nexpress/theme";
import { PublicMemberProfile } from "./public-member-profile.js";

vi.stubGlobal("React", { createElement, Fragment });
afterAll(() => vi.unstubAllGlobals());

const props: NpThemeMemberProfileProps = {
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    handle: "alice",
    displayName: "Alice",
    avatarUrl: null,
    bio: "Public bio",
    reputation: 12,
    joinedAt: "2026-07-20T00:00:00.000Z",
  },
  activity: {
    kind: "documents",
    items: [
      {
        kind: "document",
        collectionSlug: "forum-posts",
        collectionLabel: "Forum post",
        documentId: "22222222-2222-4222-8222-222222222222",
        title: "Hello forum",
        href: "/boards/free/22222222-2222-4222-8222-222222222222",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
    ],
    totalDocs: 1,
    totalPages: 1,
    page: 1,
    limit: 20,
    hasNextPage: false,
    hasPrevPage: false,
  },
  followAction: <button type="button">Follow</button>,
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
    emptyBio: "No public bio yet.",
    emptyDocuments: "No public posts yet.",
    emptyComments: "No public comments yet.",
    previous: "Previous",
    next: "Next",
    memberSince: "Member since",
    reputation: "Reputation",
    activityNavigation: "Member activity",
    paginationNavigation: "Activity pagination",
  },
};

describe("PublicMemberProfile", () => {
  it("renders exact profile activity through stable theme hooks", () => {
    const html = renderToStaticMarkup(<PublicMemberProfile {...props} />);
    expect(html).toContain('data-np-member-profile="alice"');
    expect(html).toContain('data-np-member-activity="documents"');
    expect(html).toContain('data-np-member-activity-item="document"');
    expect(html).toContain('href="/u/alice?activity=comments"');
    expect(html).toContain("Hello forum");
  });

  it("keeps the framework fallback complete when the member has no bio", () => {
    const html = renderToStaticMarkup(
      <PublicMemberProfile {...props} profile={{ ...props.profile, bio: null }} />,
    );
    expect(html).toContain("No public bio yet.");
    expect(html).toContain('class="np-member-profile-bio is-empty"');
  });
});
