import { describe, expect, it } from "vitest";

import type { NpCollectionConfig } from "../config/types.js";
import { npCanReadCommunityDocument, npGetCommunityDocumentAudience } from "./audience.js";

const config: NpCollectionConfig = {
  slug: "forum-posts",
  labels: { singular: "Forum post", plural: "Forum posts" },
  community: { audience: true },
  fields: [],
};

const document = {
  id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
  status: "published",
  visibility: "public",
  audience: "public",
  memberAuthorId: "815e8881-69e1-4311-ae51-bc52129a7cf4",
};

describe("community document audience", () => {
  it("separates anonymous, member, and private owner reads", async () => {
    await expect(npCanReadCommunityDocument(config, document)).resolves.toBe(true);
    await expect(
      npCanReadCommunityDocument(config, { ...document, audience: "members" }),
    ).resolves.toBe(false);
    await expect(
      npCanReadCommunityDocument(
        config,
        { ...document, audience: "members" },
        {
          kind: "member",
          memberId: "4cc1a5f7-8d99-44be-a711-18516de915cf",
        },
      ),
    ).resolves.toBe(true);
    await expect(
      npCanReadCommunityDocument(
        config,
        { ...document, audience: "private" },
        {
          kind: "member",
          memberId: document.memberAuthorId,
        },
      ),
    ).resolves.toBe(true);
  });

  it("fails closed on invalid audience and lifecycle state", async () => {
    expect(npGetCommunityDocumentAudience(config, { ...document, audience: "friends" })).toBeNull();
    await expect(
      npCanReadCommunityDocument(config, { ...document, audience: "friends" }),
    ).resolves.toBe(false);
    await expect(
      npCanReadCommunityDocument(
        config,
        { ...document, status: "pending" },
        {
          kind: "member",
          memberId: document.memberAuthorId,
        },
      ),
    ).resolves.toBe(false);
    await expect(
      npCanReadCommunityDocument(
        config,
        { ...document, status: "pending" },
        { kind: "member", memberId: document.memberAuthorId },
        { allowUnpublished: true },
      ),
    ).resolves.toBe(true);
  });

  it("preserves the published/public rule for collections without audience opt-in", async () => {
    const legacy = { ...config, community: undefined };
    await expect(npCanReadCommunityDocument(legacy, document)).resolves.toBe(true);
    await expect(
      npCanReadCommunityDocument(legacy, { ...document, status: "draft" }),
    ).resolves.toBe(false);
  });
});
