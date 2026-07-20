import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForumPostReportAction } from "./client/forum-post-report-action.js";

describe("forum post report action", () => {
  it("renders a localized member action without opening the dialog on first paint", () => {
    const markup = renderToStaticMarkup(
      <ForumPostReportAction
        collectionSlug="forum-posts"
        postId="00000000-0000-4000-8000-000000000000"
        labels={{
          report: "신고",
          title: "게시글 신고",
          help: "문제를 알려주세요.",
          placeholder: "신고 사유",
          submit: "신고 보내기",
          submitting: "보내는 중…",
          success: "신고했습니다.",
          close: "닫기",
          cancel: "취소",
          failed: "신고 실패",
        }}
      />,
    );

    expect(markup).toBe('<button type="button">신고</button>');
    expect(markup).not.toContain('role="dialog"');
  });
});
