import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ForumModerationPanel, type ForumModerationCase } from "./client/forum-moderation-panel.js";

const report = {
  id: "726e5941-c303-4905-bd67-77c3edd9e221",
  reporterId: "03949852-6cc3-42ef-8043-cf2aa4758b17",
  targetType: "forum-posts",
  targetId: "33204610-bdf5-44f5-b9a4-2f0ab7f0a5c6",
  reason: "spam",
  resolvedAt: null,
  resolvedByUserId: null,
  resolvedByMemberId: null,
  resolution: null,
  siteId: "default",
  createdAt: "2026-07-21T00:00:00.000Z",
} as const;

const target = {
  kind: "document",
  label: "신고된 글",
  excerpt: "내용",
  status: "published",
  href: null,
  collectionSlug: "forum-posts",
  documentId: report.targetId,
  authorMemberId: null,
} as const;

const labels = {
  title: "처리할 신고",
  reason: "사유",
  dismiss: "기각",
  hideComment: "댓글 숨김",
  hidePost: "글 숨김",
  resolving: "처리 중",
  failed: "실패",
};

function render(entry: ForumModerationCase): string {
  return renderToStaticMarkup(
    <ForumModerationPanel cases={[entry]} locale="ko-KR" labels={labels} />,
  );
}

describe("forum moderation report panel", () => {
  it("does not expose a document mutation omitted by the server capability snapshot", () => {
    const html = render({ report, target, actions: ["dismiss"] });

    expect(html).toContain("기각");
    expect(html).not.toContain("글 숨김");
  });

  it("renders a state-compatible action when the server authorizes it", () => {
    const html = render({ report, target, actions: ["unpublish-document", "dismiss"] });

    expect(html).toContain("글 숨김");
    expect(html).toContain("기각");
  });
});
