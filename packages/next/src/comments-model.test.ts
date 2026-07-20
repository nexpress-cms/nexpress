import type { NpCommentListItemWire } from "@nexpress/core/community-contract";
import { describe, expect, it } from "vitest";

import { npBuildCommentTree } from "./comments-model.js";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function comment(id: string, parentId: string | null): NpCommentListItemWire {
  return {
    id,
    targetType: "posts",
    targetId: TARGET_ID,
    parentId,
    memberId: MEMBER_ID,
    bodyMd: id,
    bodyHtml: `<p>${id}</p>`,
    status: "visible",
    hiddenByUserId: null,
    hiddenByMemberId: null,
    hiddenReason: null,
    editedAt: null,
    siteId: "default",
    createdAt: "2026-07-20T00:00:00.000Z",
    author: null,
    reactions: { counts: {}, mine: [] },
  };
}

describe("npBuildCommentTree", () => {
  it("preserves root and sibling order while nesting replies", () => {
    const root = "33333333-3333-4333-8333-333333333333";
    const replyA = "44444444-4444-4444-8444-444444444444";
    const replyB = "55555555-5555-4555-8555-555555555555";
    const other = "66666666-6666-4666-8666-666666666666";
    const tree = npBuildCommentTree([
      comment(root, null),
      comment(replyA, root),
      comment(replyB, root),
      comment(other, null),
    ]);
    expect(tree.map((node) => node.comment.id)).toEqual([root, other]);
    expect(tree[0]?.children.map((node) => node.comment.id)).toEqual([replyA, replyB]);
  });

  it("renders missing and cyclic parents as bounded detached roots", () => {
    const first = "77777777-7777-4777-8777-777777777777";
    const second = "88888888-8888-4888-8888-888888888888";
    const missing = "99999999-9999-4999-8999-999999999999";
    const tree = npBuildCommentTree([
      comment(first, second),
      comment(second, first),
      comment(missing, TARGET_ID),
    ]);
    expect(tree).toHaveLength(3);
    expect(tree.every((node) => node.detached)).toBe(true);
  });
});
