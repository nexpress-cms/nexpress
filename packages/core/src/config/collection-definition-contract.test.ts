import { describe, expect, it } from "vitest";

import { defineCollection } from "./define-collection.js";
import type { NpCollectionConfig } from "./types.js";
import {
  npAnalyzeCollectionDefinition,
  npAnalyzeCollectionDefinitions,
  npValidateCollectionDefinition,
} from "./collection-definition-contract.js";

function validCollection(): NpCollectionConfig {
  return {
    slug: "articles",
    labels: { singular: "Article", plural: "Articles" },
    slugField: { useField: "title", unique: true },
    fields: [
      { name: "title", type: "text" as const, minLength: 1, maxLength: 120 },
      {
        type: "row" as const,
        fields: [
          {
            name: "kind",
            type: "select" as const,
            options: [
              { label: "Article", value: "article" },
              { label: "Guide", value: "guide" },
            ],
          },
          { name: "publishedAt", type: "date" as const },
        ],
      },
      {
        name: "metadata",
        type: "group" as const,
        fields: [{ name: "summary", type: "textarea" as const, maxLength: 200 }],
      },
      {
        name: "sections",
        type: "array" as const,
        minRows: 0,
        maxRows: 10,
        fields: [{ name: "heading", type: "text" as const }],
      },
      { name: "coverImage", type: "upload" as const, relationTo: "media" },
    ],
    admin: {
      listColumns: ["title", "kind", "status", "updatedAt"],
      defaultSort: "-updatedAt",
      navMembership: true,
      icon: "Newspaper",
      groupMeta: { SEO: { icon: "Search", description: "Search preview" } },
    },
    seo: { urlPath: (doc: Record<string, unknown>) => `/articles/${String(doc.slug)}` },
  };
}

describe("collection definition contract", () => {
  it("accepts the current collection surface and preserves identity", () => {
    const collection = validCollection();
    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
    expect(defineCollection(collection)).toBe(collection);
  });

  it("makes defineCollection fail immediately for an invalid definition", () => {
    const collection = validCollection();
    collection.fields.push({ name: "createdAt", type: "date" });

    expect(() => defineCollection(collection)).toThrow(
      /Invalid collection definition at fields\.5\.name: field name "createdAt" is framework-reserved/,
    );
  });

  it("rejects unknown collection, field, and admin properties", () => {
    const collection = validCollection() as unknown as Record<string, unknown>;
    collection.typo = true;
    expect(npAnalyzeCollectionDefinition(collection)[0]).toEqual(
      expect.objectContaining({ code: "shape", message: expect.stringMatching(/typo/) }),
    );

    const fieldTypo = validCollection() as unknown as { fields: Array<Record<string, unknown>> };
    const firstField = fieldTypo.fields[0];
    if (!firstField) throw new Error("fixture drift");
    firstField.maxLenght = 10;
    expect(npAnalyzeCollectionDefinition(fieldTypo)[0]).toEqual(
      expect.objectContaining({ code: "shape", message: expect.stringMatching(/maxLenght/) }),
    );
  });

  it("rejects duplicate names across layout containers and nested option values", () => {
    const collection = validCollection();
    collection.fields.push({
      type: "collapsible",
      label: "Duplicate",
      fields: [{ name: "kind", type: "text" }],
    });
    const select = collection.fields[1];
    if (select?.type !== "row" || select.fields[0]?.type !== "select") {
      throw new Error("fixture drift");
    }
    select.fields[0].options.push({ label: "Again", value: "article" });

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/duplicate field name "kind"/) }),
        expect.objectContaining({ message: 'duplicate option value "article".' }),
      ]),
    );
  });

  it("rejects inverted bounds and duplicate block or relationship inventories", () => {
    const collection = validCollection();
    collection.fields.push(
      {
        name: "bodyBlocks",
        type: "blocks",
        minRows: 3,
        maxRows: 1,
        allowedBlocks: ["hero", "hero"],
      },
      {
        name: "related",
        type: "relationship",
        relationTo: ["articles", "articles"],
      },
    );

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "minimum must not exceed maximum." }),
        expect.objectContaining({ message: 'duplicate block type "hero".' }),
        expect.objectContaining({ message: 'duplicate relationship target "articles".' }),
      ]),
    );
  });

  it("rejects declarations that collection persistence cannot represent", () => {
    const collection = validCollection();
    collection.fields.push(
      {
        name: "audiences",
        type: "select",
        hasMany: true,
        options: [{ label: "Members", value: "members" }],
      },
      {
        name: "polymorphic",
        type: "relationship",
        relationTo: ["articles", "pages"],
      },
      {
        name: "nested",
        type: "group",
        fields: [
          {
            name: "items",
            type: "array",
            fields: [{ name: "label", type: "text" }],
          },
        ],
      },
    );

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/select.*hasMany persistence/) }),
        expect.objectContaining({ message: expect.stringMatching(/polymorphic relationship/) }),
        expect.objectContaining({
          message: expect.stringMatching(/array fields cannot be nested/),
        }),
      ]),
    );
  });

  it("rejects unsafe, reserved, and generated-column field names", () => {
    const collection = validCollection();
    collection.fields.push(
      { name: "Bad Name", type: "text" },
      { name: "createdAt", type: "date" },
      { name: "slug", type: "text" },
    );

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/lower camelCase/) }),
        expect.objectContaining({ message: expect.stringMatching(/framework-reserved/) }),
        expect.objectContaining({ message: expect.stringMatching(/generated slug column/) }),
      ]),
    );
  });

  it("requires canonical non-framework collection slugs", () => {
    expect(
      npAnalyzeCollectionDefinition({
        ...validCollection(),
        slug: "articles-",
      })[0],
    ).toEqual(expect.objectContaining({ code: "shape", location: "slug" }));
    expect(
      npAnalyzeCollectionDefinition({
        ...validCollection(),
        slug: "users",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/framework relation target/) }),
      ]),
    );
  });

  it("rejects missing slug and Admin field references", () => {
    const collection = validCollection();
    collection.slugField = { useField: "headline", unique: true };
    collection.admin = {
      ...collection.admin,
      listColumns: ["title", "missing"],
      defaultSort: "-alsoMissing",
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/slugField source "headline"/) }),
        expect.objectContaining({ message: expect.stringMatching(/list column "missing"/) }),
        expect.objectContaining({ message: expect.stringMatching(/sort field "alsoMissing"/) }),
      ]),
    );
  });

  it("rejects invalid relationship and upload targets", () => {
    const collection = validCollection();
    collection.fields.push(
      { name: "author", type: "relationship", relationTo: "Bad Target" },
      { name: "attachment", type: "upload", relationTo: "assets" },
    );

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/lowercase collection slug/) }),
        expect.objectContaining({ message: expect.stringMatching(/framework "media"/) }),
      ]),
    );
  });

  it("rejects flattened storage collisions and nested table system names", () => {
    const collection = validCollection();
    collection.fields.push(
      { name: "metadataSummary", type: "text" },
      {
        name: "created",
        type: "group",
        fields: [{ name: "at", type: "date" }],
      },
      {
        name: "items",
        type: "array",
        fields: [{ name: "order", type: "number" }],
      },
    );

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/storage field "metadataSummary"/),
        }),
        expect.objectContaining({
          message: expect.stringMatching(/storage field "order"/),
        }),
        expect.objectContaining({
          message: expect.stringMatching(/storage field "createdAt"/),
        }),
      ]),
    );
  });

  it("requires slug derivation to use a string-valued field", () => {
    const collection = validCollection();
    collection.slugField = { useField: "metadata", unique: true };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/top-level string field/) }),
      ]),
    );
  });

  it("validates duplicate slugs and cross-collection relationship targets as a set", () => {
    const collection = validCollection();
    collection.fields.push({ name: "topic", type: "relationship", relationTo: "topics" });

    expect(npAnalyzeCollectionDefinitions([collection, { ...validCollection() }])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/duplicate collection slug/) }),
        expect.objectContaining({
          message: expect.stringMatching(/target "topics" is not a declared collection/),
        }),
      ]),
    );
  });

  it("requires Admin references to resolve to columns enabled by this collection", () => {
    const collection = validCollection();
    collection.timestamps = false;
    collection.admin = {
      listColumns: ["title", "updatedAt", "locale"],
      defaultSort: "-sections",
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/list column "updatedAt"/) }),
        expect.objectContaining({ message: expect.stringMatching(/list column "locale"/) }),
        expect.objectContaining({ message: expect.stringMatching(/sort field "sections"/) }),
      ]),
    );
  });

  it("validates member writable fields and row-aware policy opt-ins", () => {
    const collection = validCollection();
    collection.community = {
      comments: true,
      follows: true,
      reports: true,
      memberWrite: {
        create: true,
        writableFields: ["title", "title", "missing"],
        access: {
          create: () => true,
          update: () => true,
        },
        resolveCreateStatus: () => "published",
      },
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate writable field "title".' }),
        expect.objectContaining({
          message: 'member writable field "missing" is not a top-level collection field.',
        }),
        expect.objectContaining({
          message: "member update access requires community.memberWrite.update=true.",
        }),
      ]),
    );
  });

  it("accepts an exact member-write field and policy contract", () => {
    const collection = validCollection();
    collection.community = {
      comments: true,
      reports: true,
      memberWrite: {
        create: true,
        update: true,
        delete: true,
        writableFields: ["title", "metadata", "sections"],
        access: {
          create: () => true,
          update: () => true,
          delete: () => true,
        },
        resolveCreateStatus: () => "pending",
      },
    };

    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
  });

  it("validates declarative thread moderation field mappings", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.community = {
      moderation: {
        categoryField: "title",
        hiddenField: "missingHidden",
        lockField: "missing",
        pinField: "title",
      },
      memberWrite: { update: true },
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.moderation",
          message: expect.stringMatching(/memberWrite\.delete=true/u),
        }),
        expect.objectContaining({
          location: "community.moderation.categoryField",
          message: expect.stringMatching(/single.*relationship/u),
        }),
        expect.objectContaining({
          location: "community.moderation.hiddenField",
          message: expect.stringMatching(/not a top-level/u),
        }),
        expect.objectContaining({
          location: "community.moderation.lockField",
          message: expect.stringMatching(/not a top-level/u),
        }),
        expect.objectContaining({
          location: "community.moderation.pinField",
          message: expect.stringMatching(/checkbox/u),
        }),
      ]),
    );
  });

  it("accepts one complete thread moderation projection", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.fields.push(
      { type: "relationship", name: "board", relationTo: "boards", required: true },
      { type: "checkbox", name: "moderationHidden", required: true, defaultValue: false },
      { type: "checkbox", name: "locked", defaultValue: false },
      { type: "checkbox", name: "pinned", defaultValue: false },
    );
    collection.community = {
      moderation: {
        categoryField: "board",
        hiddenField: "moderationHidden",
        lockField: "locked",
        pinField: "pinned",
      },
      memberWrite: { update: true, delete: true, writableFields: ["title"] },
    };

    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
  });

  it("requires a non-null hidden-state marker for thread moderation", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.fields.push({
      type: "checkbox",
      name: "moderationHidden",
      defaultValue: false,
    });
    collection.community = {
      moderation: { hiddenField: "moderationHidden" },
      memberWrite: { update: true, delete: true, writableFields: ["title"] },
    };

    expect(npValidateCollectionDefinition(collection)).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "field",
        location: "community.moderation.hiddenField",
        message: expect.stringMatching(/required.*default/u),
      }),
    });
  });

  it("requires a non-null category relationship for scope projection", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.fields.push(
      { type: "relationship", name: "board", relationTo: "boards" },
      {
        type: "checkbox",
        name: "moderationHidden",
        required: true,
        defaultValue: false,
      },
    );
    collection.community = {
      moderation: { categoryField: "board", hiddenField: "moderationHidden" },
      memberWrite: { update: true, delete: true, writableFields: ["title"] },
    };

    expect(npValidateCollectionDefinition(collection)).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: "reference",
        location: "community.moderation.categoryField",
        message: expect.stringMatching(/required/u),
      }),
    });
  });

  it("keeps every thread moderation state field outside member patches", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.fields.push(
      {
        type: "checkbox",
        name: "moderationHidden",
        required: true,
        defaultValue: false,
      },
      { type: "checkbox", name: "locked", defaultValue: false },
    );
    collection.community = {
      moderation: { hiddenField: "moderationHidden", lockField: "locked" },
      memberWrite: {
        update: true,
        delete: true,
        writableFields: ["title", "locked"],
      },
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.memberWrite.writableFields",
          message: expect.stringMatching(/operator-only/u),
        }),
      ]),
    );
  });

  it("requires distinct thread moderation state fields", () => {
    const collection = validCollection();
    collection.versions = { drafts: true };
    collection.fields.push({
      type: "checkbox",
      name: "moderationState",
      required: true,
      defaultValue: false,
    });
    collection.community = {
      moderation: {
        hiddenField: "moderationState",
        lockField: "moderationState",
      },
      memberWrite: { update: true, delete: true, writableFields: ["title"] },
    };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.moderation",
          message: expect.stringMatching(/distinct/u),
        }),
      ]),
    );
  });

  it("validates explicit public profile activity dependencies", () => {
    const collection = validCollection();
    collection.community = {
      profileActivity: { documents: true, comments: true },
    };
    collection.seo = undefined;

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.profileActivity.documents",
          message: expect.stringMatching(/memberWrite\.create=true/u),
        }),
        expect.objectContaining({
          location: "community.profileActivity.comments",
          message: expect.stringMatching(/comments=true/u),
        }),
        expect.objectContaining({
          location: "community.profileActivity",
          message: expect.stringMatching(/seo\.urlPath/u),
        }),
      ]),
    );
  });

  it("accepts an exact public profile activity contract", () => {
    const collection = validCollection();
    collection.community = {
      comments: true,
      memberWrite: { create: true },
      profileActivity: { documents: true, comments: true },
    };
    collection.seo = { urlPath: (doc) => `/discussions/${String(doc.id)}` };

    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
  });

  it("requires the exact canonical audience field contract", () => {
    const collection = validCollection();
    collection.community = { audience: true };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.audience",
          message: expect.stringMatching(/top-level select field/u),
        }),
      ]),
    );

    collection.fields.push({
      type: "select",
      name: "audience",
      required: true,
      defaultValue: "public",
      options: [
        { label: "Everyone", value: "public" },
        { label: "Members", value: "members" },
        { label: "Private", value: "private" },
      ],
    });
    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });

    collection.community.audienceCategoryField = "id";
    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
    collection.community.audienceCategoryField = "missing";
    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "community.audienceCategoryField" }),
      ]),
    );
    delete collection.community.audienceCategoryField;

    const malformed = {
      ...collection,
      fields: collection.fields.map((field) =>
        "name" in field && field.name === "audience"
          ? { ...field, defaultValue: "members" }
          : field,
      ),
    };
    expect(npAnalyzeCollectionDefinition(malformed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.audience",
          message: expect.stringMatching(/defaultValue="public"/u),
        }),
      ]),
    );

    const undeclared = validCollection();
    undeclared.fields.push(collection.fields.at(-1)!);
    expect(npAnalyzeCollectionDefinition(undeclared)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "fields.audience",
          message: expect.stringMatching(/reserved/u),
        }),
      ]),
    );
  });

  it("rejects document reports on reserved target slugs", () => {
    const collection = validCollection();
    collection.slug = "comment";
    collection.community = { reports: true };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.reports",
          message: expect.stringMatching(/reserved report target/),
        }),
      ]),
    );
  });

  it("rejects document follows on the reserved member target", () => {
    const collection = validCollection();
    collection.slug = "member";
    collection.community = { follows: true };

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.follows",
          message: expect.stringMatching(/reserved follow target/),
        }),
      ]),
    );
  });

  it("requires follow-enabled collections to define a public URL resolver", () => {
    const collection = validCollection();
    collection.community = { follows: true };
    collection.seo = undefined;

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "community.follows",
          message: expect.stringMatching(/require seo\.urlPath/u),
        }),
      ]),
    );
  });

  it("accepts an empty writable field allowlist for delete-only member contracts", () => {
    const collection = validCollection();
    collection.community = {
      memberWrite: {
        delete: true,
        writableFields: [],
        access: { delete: () => true },
      },
    };

    expect(npValidateCollectionDefinition(collection)).toEqual({ ok: true });
  });

  it("allows publishedAt only as a top-level date field", () => {
    const collection = validCollection();
    collection.fields.push({
      name: "publishing",
      type: "group",
      fields: [{ name: "publishedAt", type: "date" }],
    });

    expect(npAnalyzeCollectionDefinition(collection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/must be a top-level field/) }),
      ]),
    );
  });
});
