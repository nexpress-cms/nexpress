import { beforeEach, describe, expect, it, vi } from "vitest";
import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { NpAuthUser } from "../config/types.js";
import type { NpTransaction } from "../collections/pipeline.js";
import type * as CollectionPipeline from "../collections/pipeline.js";
import type * as CollectionContract from "../collection-contract/contract.js";
import type { NpCommentRow } from "../community-contract/types.js";
import { npComments } from "../db/schema/community.js";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  readAccess: vi.fn(),
  audience: vi.fn(),
  save: vi.fn(),
  reputation: vi.fn(),
  realtime: vi.fn(),
  table: vi.fn(),
  site: vi.fn(),
  effects: vi.fn(),
}));

vi.mock("../collections/pipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CollectionPipeline>();
  return {
    ...actual,
    npGetPersistedCollectionDocumentById: mocks.read,
    npAssertCollectionReadAccess: mocks.readAccess,
    saveDocument: mocks.save,
  };
});
vi.mock("../collections/registry.js", () => ({
  getCollectionConfig: () => ({
    slug: "threads",
    community: { comments: true, moderation: { hiddenField: "moderationHidden" } },
  }),
  getCollectionTable: mocks.table,
}));
vi.mock("../collection-contract/contract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof CollectionContract>()),
  npCollectionDocumentToWriteInput: (document: Record<string, unknown>) => ({
    title: document.title,
    moderationHidden: document.moderationHidden,
  }),
}));
vi.mock("./audience.js", () => ({ npRequireReadableCommunityDocument: mocks.audience }));
vi.mock("./reputation.js", () => ({ applyReputation: mocks.reputation }));
vi.mock("./realtime.js", () => ({ npEmitCommunityDocumentChanged: mocks.realtime }));
vi.mock("../sites/context.js", () => ({ requireSiteId: mocks.site }));

import { runPostCommit, withDeferredPostCommit } from "../collections/pipeline.js";
import {
  npInspectCommunityContentContainmentV1,
  npQuarantineCommunityContentV1,
  npRestoreCommunityContentV1,
  type NpCommunityContentContainmentInputV1,
} from "./content-containment.js";

const ids = {
  comment: "11111111-1111-4111-8111-111111111111",
  document: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444",
};
const table = pgTable("test_containment_threads", {
  id: uuid("id"),
  siteId: text("site_id"),
  moderationHidden: boolean("moderation_hidden"),
});

function fixture(status: NpCommentRow["status"] = "pending") {
  const state = {
    comment: {
      id: ids.comment,
      targetType: "threads",
      targetId: ids.document,
      parentId: null,
      memberId: ids.member,
      bodyMd: "A useful community comment",
      bodyHtml: "<p>A useful community comment</p>",
      status,
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
      editedAt: null,
      siteId: "site-a",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    } satisfies NpCommentRow,
    document: {
      id: ids.document,
      siteId: "site-a",
      memberAuthorId: ids.member,
      status: "published",
      visibility: "public",
      moderationHidden: false,
      title: "Community thread",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    } as Record<string, unknown>,
    audits: [] as Record<string, unknown>[],
  };
  const selects: string[] = [];
  function rows(source: unknown) {
    const query = Object.assign(
      Promise.resolve(source === npComments ? [state.comment] : [{ id: ids.document }]),
      {
        where: () => query,
        limit: () => query,
        for: () => {
          selects.push(source === npComments ? "comment" : "document");
          return query;
        },
      },
    );
    return query;
  }
  const tx = {
    select: () => ({ from: rows }),
    update: () => ({
      set: (patch: Partial<NpCommentRow>) => ({
        where: () => ({
          returning: () => {
            Object.assign(state.comment, patch);
            return Promise.resolve([state.comment]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        state.audits.push(value);
        return Promise.resolve();
      },
    }),
  } as unknown as NpTransaction;
  const input: NpCommunityContentContainmentInputV1 = {
    siteId: "site-a",
    target: { kind: "comment", collection: "threads", id: ids.comment },
    user: { id: ids.user, role: "moderator" } as NpAuthUser,
  };
  mocks.read.mockImplementation(() => Promise.resolve(structuredClone(state.document)));
  mocks.save.mockImplementation(async (_collection, _id, patch, _user, options) => {
    Object.assign(state.document, patch, { status: options.status, updatedAt: new Date() });
    await runPostCommit(
      "test:document-update",
      { collection: "threads", documentId: ids.document },
      mocks.effects,
    );
    return { doc: structuredClone(state.document), operation: "update" };
  });
  async function transaction<T>(callback: () => Promise<T>): Promise<T> {
    const before = structuredClone(state);
    return withDeferredPostCommit(async () => {
      try {
        return await callback();
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    });
  }
  async function quarantine() {
    return transaction(async () => {
      const inspected = await npInspectCommunityContentContainmentV1(tx, input);
      return npQuarantineCommunityContentV1(tx, {
        ...input,
        expectedVersionDigest: inspected.versionDigest,
        reasonCode: "REPEATED_LINK_SPAM",
      });
    });
  }
  return { state, input, tx, selects, transaction, quarantine };
}

describe("community content containment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.site.mockResolvedValue("site-a");
    mocks.table.mockReturnValue(table);
    mocks.readAccess.mockResolvedValue(undefined);
    mocks.audience.mockResolvedValue(undefined);
  });

  it.each(["pending", "visible"] as const)(
    "restores the exact original %s comment state",
    async (status) => {
      const f = fixture(status);
      const original = structuredClone(f.state.comment);
      const installed = await f.quarantine();
      expect(f.state.comment.status).toBe("hidden");
      expect(installed.originalState.state).toMatchObject({ kind: "comment", status });
      expect(f.selects.slice(0, 2)).toEqual(["document", "comment"]);
      await f.transaction(() =>
        npRestoreCommunityContentV1(f.tx, {
          ...f.input,
          originalState: installed.originalState,
          expectedVersionDigest: installed.installedVersionDigest,
        }),
      );
      expect(f.state.comment).toEqual(original);
      expect(f.state.audits.map((entry) => entry.action)).toEqual([
        "comment.hide",
        "comment.restore",
      ]);
      expect(mocks.reputation).toHaveBeenCalledTimes(1);
      expect(mocks.realtime).toHaveBeenCalledTimes(status === "visible" ? 2 : 0);
    },
  );

  it("rejects comment and parent edits after quarantine without overwriting content", async () => {
    for (const edit of ["comment", "parent"]) {
      const f = fixture("visible");
      const installed = await f.quarantine();
      if (edit === "comment") f.state.comment.bodyMd = "Human corrected the comment";
      else f.state.document.title = "Human corrected the thread";
      await expect(
        f.transaction(() =>
          npRestoreCommunityContentV1(f.tx, {
            ...f.input,
            originalState: installed.originalState,
            expectedVersionDigest: installed.installedVersionDigest,
          }),
        ),
      ).rejects.toThrow("Content containment conflict");
      expect(f.state.comment.status).toBe("hidden");
      expect(f.state.audits).toHaveLength(1);
    }
  });

  it.each(["hidden", "deleted"] as const)("rejects originally %s comments", async (status) => {
    const f = fixture(status);
    await expect(f.quarantine()).rejects.toThrow("Content containment conflict");
    expect(f.state.comment.status).toBe(status);
    expect(f.state.audits).toEqual([]);
    expect(mocks.reputation).not.toHaveBeenCalled();
  });

  it("rolls back content and audit together and drops reputation and realtime on outer failure", async () => {
    const f = fixture("visible");
    await expect(
      f.transaction(async () => {
        const inspected = await npInspectCommunityContentContainmentV1(f.tx, f.input);
        await npQuarantineCommunityContentV1(f.tx, {
          ...f.input,
          expectedVersionDigest: inspected.versionDigest,
          reasonCode: "SPAM",
        });
        expect(mocks.reputation).not.toHaveBeenCalled();
        expect(mocks.realtime).not.toHaveBeenCalled();
        throw new Error("Action persistence failed");
      }),
    ).rejects.toThrow("Action persistence failed");
    expect(f.state.comment.status).toBe("visible");
    expect(f.state.audits).toEqual([]);
    expect(mocks.reputation).not.toHaveBeenCalled();
    expect(mocks.realtime).not.toHaveBeenCalled();
  });

  it("fails closed on stale proposals, changed snapshot metadata, ACL denial and foreign sites", async () => {
    const f = fixture("visible");
    await expect(
      f.transaction(() =>
        npQuarantineCommunityContentV1(f.tx, {
          ...f.input,
          expectedVersionDigest: "stale",
          reasonCode: "SPAM",
        }),
      ),
    ).rejects.toThrow();
    const installed = await f.quarantine();
    installed.originalState.state.status = "pending";
    await expect(
      f.transaction(() =>
        npRestoreCommunityContentV1(f.tx, {
          ...f.input,
          originalState: installed.originalState,
          expectedVersionDigest: installed.installedVersionDigest,
        }),
      ),
    ).rejects.toThrow();
    mocks.readAccess.mockRejectedValueOnce(new Error("Item denied"));
    await expect(npInspectCommunityContentContainmentV1(f.tx, f.input)).rejects.toThrow(
      "Item denied",
    );
    mocks.site.mockResolvedValueOnce("site-b");
    await expect(npInspectCommunityContentContainmentV1(f.tx, f.input)).rejects.toThrow();
    expect(f.state.audits).toHaveLength(1);
  });

  it.each(["pending", "published"] as const)(
    "runs document hooks while restoring original %s and exact visibility",
    async (status) => {
      const f = fixture();
      f.input.target = { kind: "document", collection: "threads", id: ids.document };
      f.state.document.status = status;
      f.state.document.visibility = status === "pending" ? "private" : "public";
      const installed = await f.quarantine();
      expect(f.state.document).toMatchObject({ status: "pending", moderationHidden: true });
      await f.transaction(() =>
        npRestoreCommunityContentV1(f.tx, {
          ...f.input,
          originalState: installed.originalState,
          expectedVersionDigest: installed.installedVersionDigest,
        }),
      );
      expect(f.state.document).toMatchObject({
        status,
        moderationHidden: false,
        title: "Community thread",
        visibility: status === "pending" ? "private" : "public",
      });
      expect(mocks.save).toHaveBeenCalledWith(
        "threads",
        ids.document,
        { moderationHidden: false },
        f.input.user,
        { tx: f.tx, status, preserveRevisionHistory: true },
      );
      expect(mocks.effects).toHaveBeenCalledTimes(2);
    },
  );

  it("rolls back document hooks that change content outside the approved transition", async () => {
    const f = fixture();
    f.input.target = { kind: "document", collection: "threads", id: ids.document };
    mocks.save.mockImplementationOnce(async () => {
      Object.assign(f.state.document, {
        status: "pending",
        moderationHidden: true,
        title: "Unexpected hook rewrite",
      });
      await runPostCommit(
        "test:document-update",
        { collection: "threads", documentId: ids.document },
        mocks.effects,
      );
      return { doc: f.state.document, operation: "update" };
    });
    await expect(f.quarantine()).rejects.toThrow("Content containment conflict");
    expect(f.state.document).toMatchObject({
      status: "published",
      moderationHidden: false,
      title: "Community thread",
    });
    expect(mocks.effects).not.toHaveBeenCalled();
    expect(f.state.audits).toEqual([]);
  });
});
