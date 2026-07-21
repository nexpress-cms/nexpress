import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocumentById: vi.fn(),
  getSiteMember: vi.fn(),
  resolveForumSkin: vi.fn(),
  renderPostComposer: vi.fn(),
  resolveForumAttachments: vi.fn(),
  getDocumentModerationPermissions: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  getDocumentById: mocks.getDocumentById,
}));

vi.mock("@nexpress/core/community", () => ({
  getDocumentModerationPermissions: mocks.getDocumentModerationPermissions,
}));

vi.mock("@nexpress/next", () => ({
  getSiteMember: mocks.getSiteMember,
}));

vi.mock("@nexpress/plugin-forum/client", () => ({
  ForumPostForm: ({ mode }: { mode: string }) => <form data-forum-form={mode} />,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

const board = {
  id: "board-1",
  key: "free",
  name: "자유게시판",
  description: null,
  skinId: "compact",
  audience: "public" as const,
  writeMode: "members" as const,
  moderation: "published" as const,
  commentsEnabled: true,
  pageSize: 20,
  categories: [],
  attachments: {
    enabled: true,
    maxFiles: 5,
    maxFileSizeBytes: 20 * 1024 * 1024,
  },
};

const messages = {
  newPost: "글쓰기",
  editPost: "글 수정",
  backToPost: "게시글로",
  loginRequired: "로그인이 필요합니다.",
  signIn: "로그인",
  register: "회원가입",
  category: "분류",
  categoryNone: "없음",
  audience: "공개 범위",
  audiencePublic: "전체 공개",
  audienceMembers: "회원 공개",
  audiencePrivate: "작성자와 운영자만",
  title: "제목",
  body: "내용",
  loadingEditor: "불러오는 중",
  saving: "저장 중",
  create: "등록",
  save: "수정",
  saveFailed: "저장 실패",
};

const attachmentLabels = {
  attachments: "첨부파일",
  addAttachments: "파일 추가",
  uploadingAttachment: "업로드 중",
  removeAttachment: "삭제",
  attachmentHelp: "최대 5개",
  attachmentUploadFailed: "업로드 실패",
  attachmentTooLarge: "파일이 너무 큽니다.",
  attachmentLimitExceeded: "첨부파일 수를 초과했습니다.",
};

vi.mock("./runtime.js", () => ({
  findForumBoardByKey: vi.fn(() => Promise.resolve(board)),
  getForumMessages: vi.fn(() => Promise.resolve(messages)),
  getForumAttachmentFormLabels: vi.fn(() => Promise.resolve(attachmentLabels)),
  isForumPostId: vi.fn(() => true),
  resolveForumAttachments: mocks.resolveForumAttachments,
  resolveForumSkin: mocks.resolveForumSkin,
}));

import { createForumPostEditRoute } from "./routes/forum-post-edit.js";
import { createForumPostNewRoute } from "./routes/forum-post-new.js";

const runtime = {
  basePath: "/boards",
  collections: { boards: "forum-boards", posts: "forum-posts" },
  defaultSkinId: "classic",
  skins: new Map(),
};

const routeProps = {
  params: {
    boardKey: "free",
    postId: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
  },
  searchParams: {},
  blockCtx: {},
};

describe("forum composer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSiteMember.mockResolvedValue({ id: "member-1" });
    mocks.getDocumentById.mockResolvedValue({
      id: routeProps.params.postId,
      board: board.id,
      memberAuthorId: "member-1",
      title: "기존 글",
      body: null,
      category: null,
      audience: "private",
      attachments: [],
    });
    mocks.resolveForumAttachments.mockResolvedValue([]);
    mocks.getDocumentModerationPermissions.mockResolvedValue({ editThread: false });
    mocks.resolveForumSkin.mockReturnValue({
      renderPostComposer: mocks.renderPostComposer,
    });
    mocks.renderPostComposer.mockImplementation((props: { mode: string; content: ReactNode }) => (
      <section data-selected-composer={props.mode}>{props.content}</section>
    ));
  });

  it("passes the authenticated create form through the board-selected skin", async () => {
    const route = createForumPostNewRoute(runtime);
    const page = await route(routeProps as never);
    const html = renderToStaticMarkup(<>{page}</>);

    expect(mocks.renderPostComposer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "create", board, title: "글쓰기" }),
    );
    expect(mocks.resolveForumSkin).toHaveBeenCalledWith(runtime, "compact");
    expect(html).toContain('data-selected-composer="create"');
    expect(html).toContain('data-forum-form="create"');
  });

  it("passes the unauthenticated create gate through the same selected skin", async () => {
    mocks.getSiteMember.mockResolvedValue(null);
    const route = createForumPostNewRoute(runtime);
    const page = await route(routeProps as never);
    const html = renderToStaticMarkup(<>{page}</>);

    expect(mocks.renderPostComposer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "create", board }),
    );
    expect(mocks.resolveForumSkin).toHaveBeenCalledWith(runtime, "compact");
    expect(html).toContain("로그인이 필요합니다.");
    expect(html).toContain("/members/login?next=%2Fboards%2Ffree%2Fnew");
  });

  it("passes the owner edit form through the board-selected skin", async () => {
    const route = createForumPostEditRoute(runtime);
    const page = await route(routeProps as never);
    const html = renderToStaticMarkup(<>{page}</>);

    expect(mocks.renderPostComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "edit",
        board,
        title: "글 수정",
        backHref: `/boards/free/${routeProps.params.postId}`,
      }),
    );
    expect(mocks.resolveForumSkin).toHaveBeenCalledWith(runtime, "compact");
    expect(html).toContain('data-selected-composer="edit"');
    expect(html).toContain('data-forum-form="edit"');
  });

  it("allows a scoped moderator to use the same route-owned edit form", async () => {
    mocks.getDocumentById.mockResolvedValue({
      id: routeProps.params.postId,
      board: board.id,
      memberAuthorId: "author-1",
      title: "검토할 글",
      body: null,
      category: null,
      audience: "members",
      attachments: [],
    });
    mocks.getDocumentModerationPermissions.mockResolvedValue({ editThread: true });

    const page = await createForumPostEditRoute(runtime)(routeProps as never);
    const html = renderToStaticMarkup(<>{page}</>);

    expect(mocks.getDocumentModerationPermissions).toHaveBeenCalledWith(
      "member-1",
      "forum-posts",
      routeProps.params.postId,
    );
    expect(html).toContain('data-forum-form="edit"');
  });
});
