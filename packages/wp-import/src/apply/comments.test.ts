import { describe, expect, it, vi } from "vitest";

import type { WpComment, WpImportRecord } from "../parse/types.js";
import { emptyCommentPlan, importPostComments, type CommentDeps } from "./comments.js";
import { emptyResumeState, type ResumeDeps } from "./resume.js";

function makeComment(partial: Partial<WpComment>): WpComment {
  return {
    wpId: 1,
    parentWpId: null,
    authorName: "Bob",
    authorEmail: "bob@example.com",
    authorUrl: null,
    date: "2025-04-01 13:00:00",
    content: "Great post",
    approved: true,
    ...partial,
  };
}

function makeRecord(comments: WpComment[]): WpImportRecord {
  return {
    wpId: 1,
    wpType: "post",
    status: "publish",
    slug: "hello",
    title: "Hello",
    excerpt: null,
    rawContent: "",
    wpAuthorLogin: "alice",
    publishedAt: "2025-04-01 12:00:00",
    updatedAt: "2025-04-01 12:00:00",
    terms: [],
    meta: {},
    mediaRefs: [],
    comments,
  };
}

function passthroughRender(s: string): string {
  return s;
}

describe("importPostComments", () => {
  it("imports approved comments and resolves the parent map within a post", async () => {
    const record = makeRecord([
      makeComment({ wpId: 10, parentWpId: null, authorName: "Bob" }),
      makeComment({
        wpId: 11,
        parentWpId: 10,
        authorName: "Alice",
        authorEmail: "alice@example.com",
        content: "thanks!",
      }),
    ]);
    const memberMap = new Map<string, string>();
    const ensureImportedMember = vi.fn(({ handle }: { handle: string }) => {
      const id = memberMap.get(handle) ?? `mem-${memberMap.size + 1}`;
      memberMap.set(handle, id);
      return Promise.resolve({ id });
    });
    let nextId = 1;
    const insertedRows: Array<{ parentId: string | null; bodyMd: string; targetId: string }> = [];
    const insertComment = vi.fn(
      (input: { parentId: string | null; bodyMd: string; targetId: string }) => {
        const id = `cmt-${nextId++}`;
        insertedRows.push({
          parentId: input.parentId,
          bodyMd: input.bodyMd,
          targetId: input.targetId,
        });
        return Promise.resolve({ id });
      },
    );
    const deps: CommentDeps = {
      ensureImportedMember,
      insertComment,
      renderBody: passthroughRender,
    };
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps,
      plan,
    });
    expect(plan.applied).toBe(2);
    expect(plan.errors).toEqual([]);
    expect(insertedRows[0]?.parentId).toBeNull();
    expect(insertedRows[1]?.parentId).toBe("cmt-1"); // resolved via the in-memory map
    expect(insertedRows[1]?.targetId).toBe("post-1");
    // Two distinct authors → two ensureImportedMember calls.
    expect(ensureImportedMember).toHaveBeenCalledTimes(2);
  });

  it("drops unapproved comments without inserting", async () => {
    const record = makeRecord([
      makeComment({ approved: false }),
      makeComment({ wpId: 2, approved: true }),
    ]);
    const insertComment = vi.fn(() => Promise.resolve({ id: "cmt" }));
    const ensureImportedMember = vi.fn(() => Promise.resolve({ id: "mem" }));
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: { ensureImportedMember, insertComment, renderBody: passthroughRender },
      plan,
    });
    expect(plan.applied).toBe(1);
    expect(plan.skippedUnapproved).toBe(1);
    expect(insertComment).toHaveBeenCalledTimes(1);
  });

  it("captures resolver failures in the plan errors", async () => {
    const record = makeRecord([makeComment({ wpId: 5 })]);
    const ensureImportedMember = vi.fn(() => Promise.reject(new Error("DB down")));
    const insertComment = vi.fn(() => Promise.resolve({ id: "x" }));
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: { ensureImportedMember, insertComment, renderBody: passthroughRender },
      plan,
    });
    expect(plan.applied).toBe(0);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]?.wpCommentId).toBe(5);
    expect(plan.errors[0]?.reason).toContain("DB down");
    expect(insertComment).not.toHaveBeenCalled();
  });

  it("derives a stable handle from email, falls back to author name", async () => {
    const record = makeRecord([
      makeComment({ wpId: 1, authorName: "Alice", authorEmail: "alice@example.com" }),
      makeComment({ wpId: 2, authorName: "Anonymous", authorEmail: null }),
    ]);
    const handlesSeen: string[] = [];
    const ensureImportedMember = vi.fn(({ handle }: { handle: string }) => {
      handlesSeen.push(handle);
      return Promise.resolve({ id: handle });
    });
    const insertComment = vi.fn(() => Promise.resolve({ id: "x" }));
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: { ensureImportedMember, insertComment, renderBody: passthroughRender },
      plan,
    });
    expect(handlesSeen[0]).toBe("alice-example-com-wpimp");
    expect(handlesSeen[1]).toBe("anonymous-wpimp");
  });

  it("renders comment markdown via the deps.renderBody hook", async () => {
    const record = makeRecord([makeComment({ content: "hi *there*" })]);
    const renderBody = vi.fn((s: string) => `<rendered>${s}</rendered>`);
    const captured: { bodyMd?: string; bodyHtml?: string } = {};
    const insertComment = vi.fn((input: { bodyMd: string; bodyHtml: string }) => {
      captured.bodyMd = input.bodyMd;
      captured.bodyHtml = input.bodyHtml;
      return Promise.resolve({ id: "x" });
    });
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: {
        ensureImportedMember: () => Promise.resolve({ id: "m" }),
        insertComment,
        renderBody,
      },
      plan,
    });
    expect(renderBody).toHaveBeenCalledWith("hi *there*");
    expect(captured.bodyMd).toBe("hi *there*");
    expect(captured.bodyHtml).toBe("<rendered>hi *there*</rendered>");
  });

  it("21.14 — skips comments whose wpCommentId is already in the resume marker", async () => {
    const record = makeRecord([
      makeComment({ wpId: 10 }),
      makeComment({ wpId: 11, parentWpId: 10, content: "reply" }),
    ]);
    const ensureImportedMember = vi.fn(() => Promise.resolve({ id: "m" }));
    const insertComment = vi.fn(() => Promise.resolve({ id: "should-not-run" }));
    const state = emptyResumeState("/wxr.xml");
    state.comments[10] = "previous-cmt";
    state.comments[11] = "previous-cmt-reply";
    const persisted: number[] = [];
    const resume: ResumeDeps = {
      state,
      persist: () => {
        persisted.push(Date.now());
      },
    };
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: { ensureImportedMember, insertComment, renderBody: passthroughRender },
      plan,
      resume,
    });
    expect(plan.applied).toBe(0);
    expect(plan.skippedByResume).toBe(2);
    expect(insertComment).not.toHaveBeenCalled();
  });

  it("21.14 — persists newly-inserted wpCommentId → id mapping into the marker", async () => {
    const record = makeRecord([makeComment({ wpId: 99 })]);
    const ensureImportedMember = vi.fn(() => Promise.resolve({ id: "m" }));
    const insertComment = vi.fn(() => Promise.resolve({ id: "fresh-cmt" }));
    const state = emptyResumeState("/wxr.xml");
    let persistCalls = 0;
    const resume: ResumeDeps = {
      state,
      persist: () => {
        persistCalls++;
      },
    };
    const plan = emptyCommentPlan();
    await importPostComments({
      record,
      postId: "post-1",
      collection: "posts",
      deps: { ensureImportedMember, insertComment, renderBody: passthroughRender },
      plan,
      resume,
    });
    expect(plan.applied).toBe(1);
    expect(state.comments[99]).toBe("fresh-cmt");
    expect(persistCalls).toBeGreaterThanOrEqual(1);
  });
});
