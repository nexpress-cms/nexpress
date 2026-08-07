import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  npCreateForumQuestionContextProof,
  npInspectForumContextualQuestions,
  npValidateForumQuestionContextCreate,
  npVerifyForumQuestionContextProof,
} from "./contextual-questions.js";
import {
  resolveForumQuestionContexts,
  type ForumPostDocument,
  type NpForumRuntime,
} from "./runtime.js";

const productId = "2d4af53e-6f78-43e0-8682-67f5a7d2b92e";
const boardId = "3bd66e58-b165-44dd-9a8a-4cb44fa7717a";
const source = {
  type: "shop-product",
  resolve: vi.fn((ids: readonly string[]) =>
    Promise.resolve(
      ids.includes(productId)
        ? [{ id: productId, label: "테스트 상품", href: "/shop/products/test-product" }]
        : [],
    ),
  ),
};
const runtime: NpForumRuntime = {
  basePath: "/boards",
  collections: { boards: "forum-boards", posts: "forum-posts" },
  defaultSkinId: "classic",
  skins: new Map(),
  contextualQuestions: {
    boardKey: "product-questions",
    sources: new Map([[source.type, source]]),
  },
};

describe("forum contextual question proof", () => {
  beforeEach(() => {
    process.env.NP_SECRET = "forum-question-test-secret-that-is-long-enough";
    source.resolve.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NP_SECRET;
  });

  it("binds one live product, board, site, label, and local href", async () => {
    const context = await npCreateForumQuestionContextProof(
      runtime,
      { id: boardId, key: "product-questions" },
      "shop-product",
      productId,
    );
    expect(context).toMatchObject({
      type: "shop-product",
      id: productId,
      label: "테스트 상품",
      href: "/shop/products/test-product",
    });
    const payload = await npVerifyForumQuestionContextProof(runtime, context?.proof);
    expect(payload).toMatchObject({
      boardId,
      boardKey: "product-questions",
      contextType: "shop-product",
      contextId: productId,
    });
  });

  it("rejects tampering, expiry, and a target that disappeared", async () => {
    const context = await npCreateForumQuestionContextProof(
      runtime,
      { id: boardId, key: "product-questions" },
      "shop-product",
      productId,
    );
    expect(context).not.toBeNull();
    await expect(
      npVerifyForumQuestionContextProof(runtime, `${context?.proof.slice(0, -1)}x`),
    ).rejects.toThrow(/signature/u);

    vi.setSystemTime(new Date("2026-08-07T01:00:01.000Z"));
    await expect(npVerifyForumQuestionContextProof(runtime, context?.proof)).rejects.toThrow(
      /expired/u,
    );

    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    source.resolve.mockResolvedValueOnce([]);
    await expect(npVerifyForumQuestionContextProof(runtime, context?.proof)).rejects.toThrow(
      /unavailable/u,
    );
  });

  it("rejects malformed, duplicate, and unrequested source targets", async () => {
    source.resolve.mockResolvedValueOnce({ nope: true } as never);
    await expect(
      npCreateForumQuestionContextProof(
        runtime,
        { id: boardId, key: "product-questions" },
        "shop-product",
        productId,
      ),
    ).rejects.toThrow(/non-array/u);

    source.resolve.mockResolvedValueOnce([
      { id: productId, label: "테스트 상품", href: "/shop/products/../admin" },
    ]);
    await expect(
      npCreateForumQuestionContextProof(
        runtime,
        { id: boardId, key: "product-questions" },
        "shop-product",
        productId,
      ),
    ).rejects.toThrow(/bounded local path/u);

    source.resolve.mockResolvedValueOnce([
      { id: productId, label: "테스트 상품", href: "/shop/products/test-product" },
      { id: productId, label: "테스트 상품", href: "/shop/products/test-product" },
    ]);
    await expect(
      npCreateForumQuestionContextProof(
        runtime,
        { id: boardId, key: "product-questions" },
        "shop-product",
        productId,
      ),
    ).rejects.toThrow(/too many targets/u);

    source.resolve.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        label: "다른 상품",
        href: "/shop/products/another-product",
      },
    ]);
    await expect(
      npCreateForumQuestionContextProof(
        runtime,
        { id: boardId, key: "product-questions" },
        "shop-product",
        productId,
      ),
    ).rejects.toThrow(/invalid target/u);
  });

  it("strips the proof and rejects a mismatched member-authored context", async () => {
    const context = await npCreateForumQuestionContextProof(
      runtime,
      { id: boardId, key: "product-questions" },
      "shop-product",
      productId,
    );
    const data = {
      board: boardId,
      contextType: context?.type,
      contextId: context?.id,
      contextLabel: context?.label,
      contextHref: context?.href,
      contextProof: context?.proof,
    };
    await expect(npValidateForumQuestionContextCreate(runtime, data)).resolves.toEqual({
      contextType: "shop-product",
      contextId: productId,
      contextLabel: "테스트 상품",
      contextHref: "/shop/products/test-product",
      contextProof: null,
    });
    await expect(
      npValidateForumQuestionContextCreate(runtime, { ...data, contextId: boardId }),
    ).rejects.toThrow("Invalid forum question context");

    const exportedSnapshot = { ...data, contextProof: null };
    await expect(npValidateForumQuestionContextCreate(runtime, exportedSnapshot)).rejects.toThrow(
      "Invalid forum question context",
    );
    await expect(
      npValidateForumQuestionContextCreate(runtime, exportedSnapshot, {
        allowUnsignedSnapshot: true,
      }),
    ).resolves.toEqual({
      contextType: "shop-product",
      contextId: productId,
      contextLabel: "테스트 상품",
      contextHref: "/shop/products/test-product",
      contextProof: null,
    });
  });

  it("contains source failures on public Forum projections but exposes missing secrets to health", async () => {
    source.resolve.mockRejectedValueOnce(new Error("source unavailable"));
    const document = {
      id: boardId,
      slug: null,
      title: "상품 문의",
      body: null,
      board: boardId,
      boardKey: "product-questions",
      category: null,
      moderationHidden: false,
      pinned: false,
      locked: false,
      audience: "public",
      contextType: "shop-product",
      contextId: productId,
      contextLabel: "저장된 상품명",
      contextHref: "/shop/products/test-product",
      contextProof: null,
      answerBody: null,
      answeredAt: null,
      answeredByUserId: null,
      memberAuthorId: null,
      status: "published",
      visibility: "public",
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies ForumPostDocument;
    await expect(resolveForumQuestionContexts(runtime, [document])).resolves.toEqual(
      new Map([
        [
          boardId,
          {
            type: "shop-product",
            id: productId,
            label: "저장된 상품명",
            href: null,
            available: false,
          },
        ],
      ]),
    );

    delete process.env.NP_SECRET;
    await expect(npInspectForumContextualQuestions(runtime)).rejects.toThrow(/NP_SECRET/u);
  });
});
