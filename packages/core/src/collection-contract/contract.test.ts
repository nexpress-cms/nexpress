import { describe, expect, it } from "vitest";

import type { NpCollectionConfig } from "../config/types.js";
import {
  NpCollectionContractError,
  npAnalyzeCollectionDocument,
  npAnalyzeCollectionFindOptions,
  npAnalyzeCollectionFindResult,
  npAnalyzeCollectionStorageRow,
  npCollectionDocumentToWriteInput,
  npHydrateCollectionDocument,
  npParseCollectionDocumentWire,
  npSerializeCollectionDocument,
} from "./contract.js";

const documentId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const categoryId = "55555555-5555-4555-8555-555555555555";
const tagId = "66666666-6666-4666-8666-666666666666";
const itemId = "77777777-7777-4777-8777-777777777777";
const createdAt = new Date("2026-07-16T01:02:03.000Z");
const updatedAt = new Date("2026-07-16T04:05:06.000Z");
const publishedAt = new Date("2026-07-20T00:00:00.000Z");
const eventAt = new Date("2026-08-01T09:30:00.000Z");

const config: NpCollectionConfig = {
  slug: "articles",
  labels: { singular: "Article", plural: "Articles" },
  slugField: { useField: "title", unique: true },
  i18n: true,
  versions: { drafts: true },
  community: { memberWrite: { create: true } },
  fields: [
    { type: "text", name: "title", required: true, minLength: 2 },
    { type: "text", name: "summary" },
    { type: "date", name: "eventAt" },
    { type: "relationship", name: "category", relationTo: "categories" },
    {
      type: "relationship",
      name: "tags",
      relationTo: "tags",
      hasMany: true,
    },
    {
      type: "group",
      name: "seo",
      fields: [
        { type: "text", name: "title" },
        { type: "checkbox", name: "index" },
      ],
    },
    {
      type: "array",
      name: "items",
      fields: [
        { type: "text", name: "label", required: true },
        { type: "date", name: "dueAt" },
      ],
    },
    { type: "json", name: "metadata" },
  ],
};

function storageRow(): Record<string, unknown> {
  return {
    id: documentId,
    status: "scheduled",
    createdBy: userId,
    updatedBy: null,
    visibility: "private",
    siteId: "default",
    createdAt,
    updatedAt,
    memberAuthorId: memberId,
    slug: "exact-contracts",
    locale: "ko",
    translationGroupId: groupId,
    publishedAt,
    title: "Exact contracts",
    summary: null,
    eventAt,
    category: categoryId,
    seoTitle: "Search title",
    seoIndex: true,
    metadata: { nested: [true, 2, "safe"] },
    searchVector: "'contract':2 'exact':1",
  };
}

function hydratedDocument(): Record<string, unknown> {
  return npHydrateCollectionDocument(config, storageRow(), {
    arrays: {
      items: [
        {
          id: itemId,
          parentId: documentId,
          order: 0,
          label: "First",
          dueAt: eventAt,
        },
      ],
    },
    hasMany: { tags: [tagId] },
  });
}

describe("collection document contract", () => {
  it("hydrates flattened storage and related tables into one exact runtime document", () => {
    expect(hydratedDocument()).toEqual({
      id: documentId,
      status: "scheduled",
      createdBy: userId,
      updatedBy: null,
      visibility: "private",
      siteId: "default",
      createdAt,
      updatedAt,
      memberAuthorId: memberId,
      slug: "exact-contracts",
      locale: "ko",
      translationGroupId: groupId,
      publishedAt,
      title: "Exact contracts",
      summary: null,
      eventAt,
      category: categoryId,
      tags: [tagId],
      seo: { title: "Search title", index: true },
      items: [{ label: "First", dueAt: eventAt }],
      metadata: { nested: [true, 2, "safe"] },
    });
  });

  it("round-trips exact API wire timestamps recursively", () => {
    const document = hydratedDocument();
    const wire = npSerializeCollectionDocument<Record<string, unknown>>(document, config);
    expect(wire).toMatchObject({
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      publishedAt: publishedAt.toISOString(),
      eventAt: eventAt.toISOString(),
      items: [{ dueAt: eventAt.toISOString() }],
    });
    expect(npParseCollectionDocumentWire(wire, config)).toEqual(document);
    expect(() =>
      npParseCollectionDocumentWire(
        { ...wire, locale: "KO", eventAt: "2026-08-01T09:30:00Z" },
        config,
      ),
    ).toThrow(NpCollectionContractError);
  });

  it("projects only writable collection fields and explicit write controls", () => {
    expect(npCollectionDocumentToWriteInput(hydratedDocument(), config)).toEqual({
      title: "Exact contracts",
      summary: null,
      eventAt: eventAt.toISOString(),
      category: categoryId,
      tags: [tagId],
      seo: { title: "Search title", index: true },
      items: [{ label: "First", dueAt: eventAt.toISOString() }],
      metadata: { nested: [true, 2, "safe"] },
      slug: "exact-contracts",
      visibility: "private",
      locale: "ko",
      translationGroupId: groupId,
      publishedAt,
    });
  });

  it("fails closed on stale columns, malformed stored values, and relation order gaps", () => {
    expect(
      npAnalyzeCollectionStorageRow({ ...storageRow(), _status: "draft" }, config),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "document.storage._status" }),
      ]),
    });
    expect(
      npAnalyzeCollectionStorageRow({ ...storageRow(), eventAt: "2026-08-01" }, config),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "document.storage.eventAt" }),
      ]),
    });
    expect(() =>
      npHydrateCollectionDocument(config, storageRow(), {
        arrays: {
          items: [
            {
              id: itemId,
              parentId: documentId,
              order: 1,
              label: "First",
              dueAt: null,
            },
          ],
        },
        hasMany: { tags: [] },
      }),
    ).toThrow(NpCollectionContractError);
  });

  it("rejects undeclared relation inventories and duplicate child row ids", () => {
    expect(() =>
      npHydrateCollectionDocument(config, storageRow(), {
        arrays: {
          unknown: [],
          items: [
            { id: itemId, parentId: documentId, order: 0, label: "First", dueAt: null },
            { id: itemId, parentId: documentId, order: 1, label: "Second", dueAt: null },
          ],
        },
        hasMany: { tags: [] },
      }),
    ).toThrow(NpCollectionContractError);
  });

  it("represents an optional flattened group as null only when every child is null", () => {
    const row = { ...storageRow(), seoTitle: null, seoIndex: null };
    const document = npHydrateCollectionDocument(config, row, {
      arrays: { items: [] },
      hasMany: { tags: [] },
    });
    expect(document.seo).toBeNull();
    expect(document.items).toEqual([]);
    expect(document.tags).toEqual([]);
  });

  it("honors timestamps=false without inventing runtime fields", () => {
    const noTimestamps: NpCollectionConfig = {
      slug: "flags",
      labels: { singular: "Flag", plural: "Flags" },
      timestamps: false,
      fields: [{ type: "checkbox", name: "enabled", required: true }],
    };
    const result = npAnalyzeCollectionDocument(
      {
        id: documentId,
        status: "published",
        createdBy: null,
        updatedBy: null,
        visibility: "public",
        siteId: "default",
        enabled: true,
      },
      noTimestamps,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects malformed rich-text and block envelopes before rendering", () => {
    const contentConfig: NpCollectionConfig = {
      slug: "content",
      labels: { singular: "Content", plural: "Content" },
      timestamps: false,
      fields: [
        { type: "richText", name: "body", required: true },
        { type: "blocks", name: "blocks", required: true },
      ],
    };
    const result = npAnalyzeCollectionDocument(
      {
        id: documentId,
        status: "published",
        createdBy: null,
        updatedBy: null,
        visibility: "public",
        siteId: "default",
        body: {},
        blocks: {},
      },
      contentConfig,
    );
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "document.body" }),
        expect.objectContaining({ path: "document.blocks" }),
      ]),
    });
  });
});

describe("collection find contracts", () => {
  it("accepts only declared fields, bounded pagination, and explicit internal wildcards", () => {
    expect(
      npAnalyzeCollectionFindOptions(
        {
          page: 2,
          limit: 25,
          sort: "-eventAt",
          search: "contract",
          locale: "ko",
          where: { status: "scheduled", tags: tagId, visibility: "*" },
        },
        config,
        { maximumLimit: 100, allowSystemWildcards: true },
      ),
    ).toMatchObject({ ok: true });

    expect(
      npAnalyzeCollectionFindOptions(
        {
          limit: 101,
          typo: true,
          where: { unknown: "x", visibility: "*", locale: "KO" },
        },
        config,
        { maximumLimit: 100 },
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "find.limit" }),
        expect.objectContaining({ path: "find.typo" }),
        expect.objectContaining({ path: "find.where.unknown" }),
        expect.objectContaining({ path: "find.where.visibility" }),
        expect.objectContaining({ path: "find.where.locale" }),
      ]),
    });
  });

  it("checks page metadata against the exact hydrated documents", () => {
    const document = hydratedDocument();
    expect(
      npAnalyzeCollectionFindResult(
        {
          docs: [document],
          totalDocs: 2,
          totalPages: 2,
          page: 1,
          limit: 1,
          hasNextPage: true,
          hasPrevPage: false,
        },
        config,
      ),
    ).toMatchObject({ ok: true });
    expect(
      npAnalyzeCollectionFindResult(
        {
          docs: [document],
          totalDocs: 1,
          totalPages: 1,
          page: 1,
          limit: 1,
          hasNextPage: true,
          hasPrevPage: false,
        },
        config,
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ path: "result.hasNextPage" })]),
    });
  });
});
