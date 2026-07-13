import { describe, expect, it } from "vitest";

import {
  diffSnapshotFields,
  parseAutosaveResponse,
  parseRevisionDetailResponse,
  parseRevisionListResponse,
} from "./revision-utils.js";

const id = "9b3dd862-3727-41b0-a2fa-f87362af6da0";
const summary = {
  id,
  version: 2,
  status: "draft",
  changedFields: ["title"],
  authorId: null,
  createdAt: "2026-07-13T00:00:00.000Z",
};

describe("revision API decoders", () => {
  it("accepts exact list, detail, and autosave responses", () => {
    expect(parseRevisionListResponse({ revisions: [summary], total: 1 })).toEqual({
      revisions: [summary],
      total: 1,
    });
    expect(parseRevisionDetailResponse({ ...summary, snapshot: { title: "Hello" } })).toEqual({
      ...summary,
      snapshot: { title: "Hello" },
    });
    expect(parseAutosaveResponse({ saved: false, revisionId: id, version: 2 })).toEqual({
      saved: false,
      revisionId: id,
      version: 2,
    });
  });

  it("fails closed on malformed or widened server payloads", () => {
    expect(() => parseRevisionListResponse({ revisions: [summary] })).toThrow(
      "Invalid revision API response",
    );
    expect(() =>
      parseRevisionDetailResponse({
        ...summary,
        snapshot: { title: "Hello" },
        collection: "posts",
      }),
    ).toThrow("exact contract fields");
    expect(() =>
      parseAutosaveResponse({ saved: true, revisionId: id, version: 2, reused: false }),
    ).toThrow("only saved, revisionId, and version");
  });

  it("keeps authoring diffs deterministic", () => {
    expect(
      diffSnapshotFields(
        { title: "Current", content: { value: 1 }, extra: true },
        { title: "Old", content: { value: 1 }, slug: "old" },
      ),
    ).toEqual(["title", "slug", "extra"]);
  });
});
