import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildForumPostListHref } from "./routes/post-list-query.js";
import { classicForumSkin } from "./skins/classic.js";
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
};

const board: NpForumBoard = {
  id: "board-1",
  key: "free",
  name: "자유게시판",
  description: "함께 이야기해요",
  skinId: "classic",
  writeMode: "members",
  moderation: "published",
  commentsEnabled: true,
  pageSize: 20,
  categories: [{ key: "question", label: "질문" }],
};

const post: NpForumPostSummary = {
  id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
  title: "첫 게시글",
  category: "question",
  pinned: false,
  locked: false,
  status: "published",
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  updatedAt: new Date("2026-07-19T00:00:00.000Z"),
  memberAuthorId: null,
  author: null,
};

const defaultQuery: NpForumPostListQuery = {
  page: 1,
  search: null,
  category: null,
  showMine: false,
};

function hrefForQuery(query: NpForumPostListQuery) {
  return (patch = {}) => buildForumPostListHref("/boards", "free", query, patch);
}

async function markup(node: ReturnType<typeof classicForumSkin.renderPostList>): Promise<string> {
  return renderToStaticMarkup(<>{await node}</>);
}

describe("classic forum skin", () => {
  it("keeps responsive header cells aligned with their body column classes", async () => {
    const html = await markup(
      classicForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [post],
        pinnedPosts: [],
        totalPages: 1,
        totalPosts: 1,
        query: defaultQuery,
        searchMaxLength: 120,
        isAuthenticated: true,
        canCreate: true,
        messages,
        hrefForQuery: hrefForQuery(defaultQuery),
      }),
    );

    expect(html).toContain('<th scope="col" class="np-forum-column-number">');
    expect(html).toContain('<th scope="col" class="np-forum-column-category">');
    expect(html).toContain('<th scope="col" class="np-forum-column-date">');
    expect(html).toContain('class="np-button-primary"');
  });

  it("renders bounded discovery controls and preserves filters in pagination", async () => {
    const query: NpForumPostListQuery = {
      page: 2,
      search: "검색어",
      category: "question",
      showMine: true,
    };
    const html = await markup(
      classicForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [post],
        pinnedPosts: [],
        totalPages: 3,
        totalPosts: 41,
        query,
        searchMaxLength: 120,
        isAuthenticated: true,
        canCreate: true,
        messages,
        hrefForQuery: hrefForQuery(query),
      }),
    );

    expect(html).toContain('role="search"');
    expect(html).toContain('type="search" maxLength="120"');
    expect(html).toContain('name="q" value="검색어"');
    expect(html).toContain('name="category" value="question"');
    expect(html).toContain('name="author" value="me"');
    expect(html).toContain(
      "/boards/free?category=question&amp;q=%EA%B2%80%EC%83%89%EC%96%B4&amp;author=me&amp;page=3",
    );
  });

  it("distinguishes an empty filtered result from an empty board", async () => {
    const query = { ...defaultQuery, search: "missing" };
    const html = await markup(
      classicForumSkin.renderPostList({
        basePath: "/boards",
        board,
        posts: [],
        pinnedPosts: [],
        totalPages: 0,
        totalPosts: 0,
        query,
        searchMaxLength: 120,
        isAuthenticated: false,
        canCreate: false,
        messages,
        hrefForQuery: hrefForQuery(query),
      }),
    );

    expect(html).toContain("검색 결과 없음");
    expect(html).toContain("검색 조건 지우기");
    expect(html).not.toContain("게시글 없음");
  });

  it("marks rich text with the forum-owned typography contract", async () => {
    const html = await markup(
      classicForumSkin.renderPostDetail({
        basePath: "/boards",
        board,
        post,
        body: (
          <>
            <h2>제목</h2>
            <ul>
              <li>항목</li>
            </ul>
          </>
        ),
        authorActions: null,
        comments: null,
        messages,
      }),
    );
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html).toContain('class="np-forum-post-body np-forum-rich-text"');
    expect(html).not.toContain(" prose");
    expect(styles).toContain(".np-forum-rich-text h1");
    expect(styles).toContain("list-style: disc");
    expect(styles).toContain(".np-forum-toolbar a:not(.np-button-primary)");
  });

  it("renders route-owned create and edit content through the selected skin", async () => {
    for (const mode of ["create", "edit"] as const) {
      const html = await markup(
        classicForumSkin.renderPostComposer({
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

      expect(html).toContain(`data-np-forum-composer="${mode}"`);
      expect(html).toContain(`data-testid="${mode}-form"`);
      expect(html).toContain('data-np-forum-skin="classic"');
    }
  });
});
