import { describe, expect, it } from "vitest";

import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";
import type { NpCollectionConfig } from "../config/types.js";
import {
  npAnalyzeAutosaveRevisionWireResult,
  npAnalyzeRevision,
  npAnalyzeRevisionSnapshot,
  npAnalyzeRevisionWire,
  npAnalyzeRevisionWireList,
  npNormalizeRevisionSnapshot,
  npSerializeRevision,
} from "./contract.js";

const config: NpCollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  slugField: true,
  versions: { drafts: { autosave: true }, max: 20 },
  fields: [
    { name: "title", type: "text", required: true, maxLength: 20 },
    { name: "publishedAt", type: "date" },
    { name: "content", type: "richText" },
    { name: "blocks", type: "blocks", maxRows: 2 },
    {
      name: "meta",
      type: "group",
      fields: [{ name: "featured", type: "checkbox" }],
    },
  ],
};

const id = "9b3dd862-3727-41b0-a2fa-f87362af6da0";
const authorId = "352726df-16ca-4db7-a77d-81b918dbd5f5";

describe("revision runtime contract", () => {
  it("normalizes Dates and object key order into bounded JSON", () => {
    const normalized = npNormalizeRevisionSnapshot({
      title: "Hello",
      publishedAt: new Date("2026-07-13T00:00:00.000Z"),
      nested: { z: true, a: undefined },
    });

    expect(normalized).toEqual({
      nested: { z: true },
      publishedAt: "2026-07-13T00:00:00.000Z",
      title: "Hello",
    });
    expect(() => npNormalizeRevisionSnapshot({ bad: Number.NaN })).toThrow("Invalid revision");
    expect(() => npNormalizeRevisionSnapshot({ bad: [undefined] })).toThrow("undefined");

    const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const safe = npNormalizeRevisionSnapshot(prototypeKey);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(JSON.stringify(safe)).toBe('{"__proto__":{"polluted":true}}');
  });

  it("allows partial autosaves but rejects unknown and malformed present fields", () => {
    expect(npAnalyzeRevisionSnapshot({ title: "" }, config)).toMatchObject({ ok: true });
    expect(
      npAnalyzeRevisionSnapshot(
        { content: npCreateEmptyRichTextContent(), meta: { featured: true } },
        config,
      ),
    ).toMatchObject({ ok: true });

    const malformed = npAnalyzeRevisionSnapshot(
      {
        unknown: true,
        title: 42,
        publishedAt: "July 13",
        content: { root: {} },
        blocks: [{ id: "hero", type: "hero", props: {}, extra: true }],
        meta: { featured: "yes", surprise: true },
      },
      config,
    );
    expect(malformed).toMatchObject({ ok: false });
    if (!malformed.ok) {
      expect(malformed.issues.map((entry) => entry.path)).toEqual(
        expect.arrayContaining([
          "snapshot.unknown",
          "snapshot.title",
          "snapshot.publishedAt",
          "snapshot.content",
          "snapshot.blocks",
          "snapshot.meta.featured",
          "snapshot.meta.surprise",
        ]),
      );
    }
  });

  it("validates persisted rows and serializes an explicit route-scoped wire shape", () => {
    const revision = {
      id,
      collection: "posts",
      documentId: "document-1",
      version: 3,
      status: "draft" as const,
      changedFields: ["title"],
      snapshot: { title: "Hello" },
      authorId,
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
    };

    expect(npAnalyzeRevision(revision, config)).toMatchObject({ ok: true });
    expect(npSerializeRevision(revision)).toEqual({
      id,
      version: 3,
      status: "draft",
      changedFields: ["title"],
      snapshot: { title: "Hello" },
      authorId,
      createdAt: "2026-07-13T00:00:00.000Z",
    });
  });

  it("rejects extra wire fields, invalid dates, unsorted changes, and loose list totals", () => {
    const wire = {
      id,
      version: 3,
      status: "draft",
      changedFields: ["title"],
      snapshot: { title: "Hello" },
      authorId,
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    expect(npAnalyzeRevisionWire(wire)).toMatchObject({ ok: true });
    expect(npAnalyzeRevisionWire({ ...wire, collection: "posts" })).toMatchObject({ ok: false });
    expect(npAnalyzeRevisionWire({ ...wire, createdAt: "yesterday" })).toMatchObject({ ok: false });
    expect(
      npAnalyzeRevisionWire({
        ...wire,
        changedFields: ["title", "content"],
        snapshot: { title: "Hello", content: null },
      }),
    ).toMatchObject({ ok: false });
    expect(
      npAnalyzeRevisionWireList({ revisions: [{ ...wire, snapshot: undefined }], total: 0 }),
    ).toMatchObject({ ok: false });
  });

  it("uses one exact autosave result contract for inserted and reused revisions", () => {
    expect(
      npAnalyzeAutosaveRevisionWireResult({ saved: false, revisionId: id, version: 4 }),
    ).toEqual({
      ok: true,
      value: { saved: false, revisionId: id, version: 4 },
    });
    expect(
      npAnalyzeAutosaveRevisionWireResult({ saved: true, revisionId: "", version: 0 }),
    ).toMatchObject({ ok: false });
  });
});
