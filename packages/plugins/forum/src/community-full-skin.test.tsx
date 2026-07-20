import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildForumPostListHref } from "./routes/post-list-query.js";
import { communityFullForumSkin } from "./skins/community-full.js";
import type {
  NpForumBoard,
  NpForumMessages,
  NpForumPostListQuery,
  NpForumPostSummary,
} from "./types.js";

const messages: NpForumMessages = {
  locale: "ko",
  boards: "게시판",
  posts: "게시글",
  allPosts: "전체글",
  myPosts: "내 글",
  newPost: "글쓰기",
  signInToPost: "로그인 후 글쓰기",
  emptyBoards: "게시판 없음",
  emptyPosts: "게시글 없음",
  emptyFilteredPosts: "검색 결과 없음",
  allCategories: "전체 분류",
  searchPosts: "게시글 검색",
  searchPlaceholder: "제목과 내용 검색",
  clearFilters: "검색 조건 지우기",
  number: "번호",
  category: "분류",
  title: "제목",
  author: "작성자",
  date: "작성일",
  notice: "공지",
  staff: "운영자",
  pending: "검토 중",
  locked: "잠김",
  views: "조회",
  commentsCount: "댓글",
  reactions: "추천",
  recommend: "추천",
  recommended: "추천 취소",
  engagementFailed: "추천 실패",
  pagination: "페이지 이동",
  boardPolicy: "게시판 운영 정책",
  writeMembers: "회원 글쓰기",
  writeStaff: "운영자만 글쓰기",
  writeClosed: "글쓰기 닫힘",
  moderationPublished: "즉시 게시",
  moderationPending: "새 글 검토 후 게시",
  commentsOpen: "댓글 사용",
  commentsClosed: "댓글 사용 안 함",
  createdAt: "작성",
  updatedAt: "수정",
  previous: "이전",
  next: "다음",
  pageOf: (page, totalPages) => `${page.toString()} / ${totalPages.toString()}`,
  backToBoard: "목록으로",
  backToPost: "게시글로",
  editPost: "글 수정",
  categoryNone: "선택 안 함",
  body: "내용",
  loadingEditor: "불러오는 중",
  saving: "저장 중",
  create: "등록",
  save: "수정",
  saveFailed: "저장 실패",
  edit: "수정",
  delete: "삭제",
  deleteConfirm: "삭제할까요?",
  cancel: "취소",
  deleting: "삭제 중",
  deleteFailed: "삭제 실패",
  signIn: "로그인",
  register: "회원가입",
  loginRequired: "로그인이 필요합니다.",
  commentsLocked: "댓글이 잠겼습니다.",
  emptyBody: "내용이 없습니다.",
  attachments: "첨부파일",
};

const board: NpForumBoard = {
  id: "board-1",
  key: "free",
  name: "자유게시판",
  description: "함께 이야기해요",
  skinId: "community-full",
  writeMode: "members",
  moderation: "pending",
  commentsEnabled: true,
  pageSize: 20,
  categories: [
    { key: "question", label: "질문" },
    { key: "guide", label: "정보" },
  ],
  attachments: {
    enabled: true,
    maxFiles: 5,
    maxFileSizeBytes: 20 * 1024 * 1024,
  },
};

const post: NpForumPostSummary = {
  id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
  title: "커뮤니티 첫 게시글",
  category: "question",
  pinned: false,
  locked: true,
  status: "pending",
  createdAt: new Date("2026-07-18T00:00:00.000Z"),
  updatedAt: new Date("2026-07-19T00:00:00.000Z"),
  memberAuthorId: "member-1",
  author: {
    id: "member-1",
    handle: "hana",
    displayName: "하나",
    avatarUrl: "https://cdn.example.com/hana.png",
  },
  engagement: {
    targetType: "forum-posts",
    targetId: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
    viewCount: 120,
    commentCount: 9,
    reactionCount: 7,
    reactions: { like: 7 },
  },
  attachmentCount: 1,
};

const notice: NpForumPostSummary = {
  ...post,
  id: "3bd66e58-b165-44dd-9a8a-4cb44fa7717a",
  title: "필독 공지",
  category: "guide",
  pinned: true,
  locked: false,
  status: "published",
  memberAuthorId: null,
  author: null,
};

async function markup(node: ReactNode | Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(<>{await node}</>);
}

function hrefForQuery(query: NpForumPostListQuery) {
  return (patch = {}) => buildForumPostListHref("/boards", "free", query, patch);
}

describe("community full forum skin", () => {
  it("renders a policy-rich board directory without theme-owned chrome", async () => {
    const html = await markup(
      communityFullForumSkin.renderBoardIndex({ basePath: "/boards", boards: [board], messages }),
    );

    expect(html).toContain('data-np-forum-skin="community-full"');
    expect(html).toContain('data-np-forum-surface="board-index"');
    expect(html).toContain("자유게시판");
    expect(html).toContain("질문");
    expect(html).toContain("회원 글쓰기");
    expect(html).toContain("새 글 검토 후 게시");
    expect(html).toContain("댓글 사용");
    expect(html).not.toContain("np-site-header");
  });

  it("surfaces notices, discovery, author identity, states, dates, and bounded pagination", async () => {
    const query: NpForumPostListQuery = {
      page: 5,
      search: "검색어",
      category: "question",
      showMine: true,
    };
    const html = await markup(
      communityFullForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [post],
        pinnedPosts: [notice],
        totalPages: 12,
        totalPosts: 240,
        query,
        searchMaxLength: 120,
        isAuthenticated: true,
        canCreate: true,
        messages,
        hrefForQuery: hrefForQuery(query),
      }),
    );

    expect(html).toContain('data-np-forum-surface="post-list"');
    expect(html).toContain('class="np-forum-community-notices"');
    expect(html).toContain("필독 공지");
    expect(html.match(/>공지</gu)).toHaveLength(2);
    expect(html).toContain("커뮤니티 첫 게시글");
    expect(html).toContain("하나");
    expect(html).toContain("@hana");
    expect(html).toContain('src="https://cdn.example.com/hana.png"');
    expect(html).toContain('data-np-forum-locked="true"');
    expect(html).toContain('data-np-forum-status="pending"');
    expect(html).toContain("수정");
    expect(html).toContain('role="search"');
    expect(html).toContain('name="category" value="question"');
    expect(html).toContain('name="author" value="me"');
    expect(html).toContain('aria-label="페이지 이동"');
    expect(html).toContain('aria-current="page" aria-label="5 / 12"');
    expect(html).toContain("…");
    expect(html).toContain(
      "/boards/free?category=question&amp;q=%EA%B2%80%EC%83%89%EC%96%B4&amp;author=me&amp;page=12",
    );
  });

  it("renders full detail identity, actions, rich text, comments, and board policy", async () => {
    const html = await markup(
      communityFullForumSkin.renderPostDetail({
        basePath: "/boards",
        board,
        post,
        body: (
          <>
            <h2>본문 제목</h2>
            <blockquote>인용문</blockquote>
          </>
        ),
        authorActions: <button type="button">수정 액션</button>,
        engagement: <div data-testid="engagement">참여 지표</div>,
        comments: <div data-testid="comments">댓글 영역</div>,
        attachments: [
          {
            id: "ec6ff5a8-90cf-4388-917e-b4cf6b6ac76a",
            filename: "운영 안내.pdf",
            mimeType: "application/pdf",
            filesize: 4096,
            downloadUrl: "/api/media/attachments/ec6ff5a8-90cf-4388-917e-b4cf6b6ac76a",
          },
        ],
        messages,
      }),
    );

    expect(html).toContain('data-np-forum-surface="post-detail"');
    expect(html).toContain('class="np-forum-post-body np-forum-rich-text"');
    expect(html).toContain("본문 제목");
    expect(html).toContain("수정 액션");
    expect(html).toContain('data-testid="comments"');
    expect(html).toContain("새 글 검토 후 게시");
    expect(html).toContain("댓글 사용");
    expect(html).toContain('data-np-forum-attachments="list"');
    expect(html).toContain("운영 안내.pdf");
  });

  it("wraps both route-owned composer modes without owning write policy", async () => {
    for (const mode of ["create", "edit"] as const) {
      const html = await markup(
        communityFullForumSkin.renderPostComposer({
          basePath: "/boards",
          board,
          mode,
          title: mode === "create" ? messages.newPost : messages.editPost,
          backHref: "/boards/free",
          backLabel: board.name,
          content: <form data-testid={`${mode}-form`} />,
          messages,
        }),
      );

      expect(html).toContain('data-np-forum-surface="composer"');
      expect(html).toContain(`data-np-forum-composer="${mode}"`);
      expect(html).toContain(`data-testid="${mode}-form"`);
      expect(html).toContain("회원 글쓰기");
    }
  });

  it("keeps filtered and unfiltered empty states distinct", async () => {
    const filtered = { page: 1, search: "missing", category: null, showMine: false };
    const filteredHtml = await markup(
      communityFullForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [],
        pinnedPosts: [],
        totalPages: 0,
        totalPosts: 0,
        query: filtered,
        searchMaxLength: 120,
        isAuthenticated: false,
        canCreate: false,
        messages,
        hrefForQuery: hrefForQuery(filtered),
      }),
    );
    const emptyQuery = { ...filtered, search: null };
    const emptyHtml = await markup(
      communityFullForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [],
        pinnedPosts: [],
        totalPages: 0,
        totalPosts: 0,
        query: emptyQuery,
        searchMaxLength: 120,
        isAuthenticated: false,
        canCreate: false,
        messages,
        hrefForQuery: hrefForQuery(emptyQuery),
      }),
    );

    expect(filteredHtml).toContain("검색 결과 없음");
    expect(filteredHtml).toContain("검색 조건 지우기");
    expect(emptyHtml).toContain("게시글 없음");
    expect(emptyHtml).not.toContain("검색 결과 없음");
  });
});
