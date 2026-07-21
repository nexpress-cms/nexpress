import { describe, expect, it } from "vitest";

import {
  NpCommunityContractError,
  npAnalyzeCommunitySettings,
  npAnalyzeModerationVerdict,
  npAnalyzeNotificationPrefs,
  npRequireAuditEventWireRow,
  npRequireBanRequest,
  npRequireCommentCreateRequest,
  npRequireCommentHideRequest,
  npRequireThreadModerationRequest,
  npRequireCommentListWire,
  npRequireCommunityJsonObject,
  npRequireCommunityPagination,
  npRequireCommunityRoleCatalog,
  npRequireCommunityScopeCatalogWire,
  npRequireCommunitySettings,
  npRequireCommunitySettingsPatch,
  npRequireContentEngagementSummary,
  npRequireContentViewReceiptWire,
  npRequireContentViewRow,
  npRequireFollowTarget,
  npRequireFollowActivityNotificationPayload,
  npRequireNotificationHref,
  npRequireNotificationRow,
  npRequireMarkNotificationsReadRequest,
  npRequireMemberProfileActivityPageWire,
  npRequireMemberProfileActivityQuery,
  npRequireModerationReportPageWire,
  npRequireNotificationKindCatalog,
  npRequireNotificationPrefs,
  npRequireNotificationPrefsPatch,
  npRequireReactionSummaryWire,
  npRequireRecordAuditEventInput,
  npRequireReactionTarget,
  npRequireReportPageWire,
  npRequireReportRequest,
  npRequireResolveReportRequest,
  npRequireReputationDelta,
  npRequireReputationEvent,
  npRequireRuntimeDiagnostics,
  npRequirePublicMemberProfileWire,
  npToCommentListItemWire,
  npToCommentWireRow,
} from "./contract.js";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-15T00:00:00.000Z";

describe("community contract", () => {
  it("accepts exact settings, zero quotas, and partial nested patches", () => {
    const settings = {
      reactionKinds: ["like", "celebrate"],
      registrationEnabled: true,
      memberUploadQuota: { perDay: 0, total: null },
    };
    expect(npRequireCommunitySettings(settings)).toEqual(settings);
    expect(npRequireCommunitySettingsPatch({ memberUploadQuota: { perDay: 3 } })).toEqual({
      memberUploadQuota: { perDay: 3 },
    });
  });

  it("rejects unknown settings fields and duplicate reaction kinds", () => {
    expect(
      npAnalyzeCommunitySettings({
        reactionKinds: ["like", "like"],
        registrationEnabled: true,
        memberUploadQuota: { perDay: null, total: null },
        typo: true,
      }).ok,
    ).toBe(false);
  });

  it("accepts compact persisted notification defaults without normalizing malformed fields", () => {
    expect(npRequireNotificationPrefs({})).toEqual({
      disabled: [],
      digest: "off",
      lastDigestAt: null,
      lastDigestAtBySite: {},
    });
    expect(npAnalyzeNotificationPrefs({ disabled: "comment.reply" }).ok).toBe(false);
    expect(npAnalyzeNotificationPrefs({ custom: true }).ok).toBe(false);
  });

  it("links preference patches to the registered notification catalog", () => {
    const catalog = npRequireNotificationKindCatalog([
      { kind: "comment.reply", label: "Replies", description: "New replies" },
    ]);
    const known = new Set(catalog.map((entry) => entry.kind));
    expect(npRequireNotificationPrefsPatch({ disabled: ["comment.reply"] }, known)).toEqual({
      disabled: ["comment.reply"],
    });
    expect(() => npRequireNotificationPrefsPatch({ disabled: ["plugin.missing"] }, known)).toThrow(
      NpCommunityContractError,
    );
  });

  it("accepts bounded notification preference diagnostics", () => {
    expect(
      npRequireRuntimeDiagnostics([
        { source: "notification-prefs", message: "invalid stored preferences", occurredAt: NOW },
      ]),
    ).toEqual([
      { source: "notification-prefs", message: "invalid stored preferences", occurredAt: NOW },
    ]);
    expect(
      npRequireRuntimeDiagnostics([
        { source: "profiles", message: "invalid activity target", occurredAt: NOW },
      ]),
    ).toEqual([{ source: "profiles", message: "invalid activity target", occurredAt: NOW }]);
  });

  it("enforces exact audit input actors and target pairs before persistence", () => {
    expect(
      npRequireRecordAuditEventInput({
        actor: { kind: "staff", userId: MEMBER_ID },
        action: "comment.hide",
        targetType: "comment",
        targetId: COMMENT_ID,
        payload: {},
      }),
    ).toEqual({
      actor: { kind: "staff", userId: MEMBER_ID },
      action: "comment.hide",
      targetType: "comment",
      targetId: COMMENT_ID,
      payload: {},
    });
    expect(() =>
      npRequireRecordAuditEventInput({
        actor: { kind: "system", userId: MEMBER_ID },
        action: "invalid",
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npRequireRecordAuditEventInput({
        actor: { kind: "member", memberId: MEMBER_ID },
        action: "invalid",
        targetType: "comment",
      }),
    ).toThrow(NpCommunityContractError);
  });

  it("rejects malformed moderation verdicts and bounded JSON hazards", () => {
    expect(npAnalyzeModerationVerdict({ kind: "allow" }).ok).toBe(false);
    expect(() => npRequireCommunityJsonObject({ score: Number.NaN })).toThrow(
      NpCommunityContractError,
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => npRequireCommunityJsonObject(circular)).toThrow(NpCommunityContractError);

    const safe = npRequireCommunityJsonObject({ nested: { value: true } });
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(safe.nested as object)).toBe(Object.prototype);
  });

  it("keeps dangerous JSON keys as inert data properties", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    const safe = npRequireCommunityJsonObject(input);
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype);
    expect(Object.hasOwn(safe, "__proto__")).toBe(true);
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects accessors, symbols, and custom array properties", () => {
    const accessor = Object.defineProperty({}, "kind", { enumerable: true, get: () => "pass" });
    expect(npAnalyzeModerationVerdict(accessor).ok).toBe(false);

    const roles = [{ role: "mod", scopeType: "site", capabilities: ["hide-comment"] }];
    Object.assign(roles, { extra: true });
    expect(() => npRequireCommunityRoleCatalog(roles)).toThrow(NpCommunityContractError);

    const symbolValue = { kind: "pass" };
    Object.defineProperty(symbolValue, Symbol("hidden"), { enumerable: true, value: true });
    expect(npAnalyzeModerationVerdict(symbolValue).ok).toBe(false);
  });

  it("validates every reputation event variant and only safe integer deltas", () => {
    expect(
      npRequireReputationEvent({
        kind: "reaction.received",
        reactionKind: "like",
        recipientId: MEMBER_ID,
        reactorId: TARGET_ID,
        targetType: "comment",
        targetId: COMMENT_ID,
      }).kind,
    ).toBe("reaction.received");
    expect(() => npRequireReputationEvent({ kind: "reaction.received" })).toThrow();
    expect(npRequireReputationDelta(-5)).toBe(-5);
    expect(() => npRequireReputationDelta(1.5)).toThrow(NpCommunityContractError);
  });

  it("serializes exact comment rows to canonical wire timestamps", () => {
    expect(
      npToCommentWireRow({
        id: COMMENT_ID,
        targetType: "posts",
        targetId: TARGET_ID,
        parentId: null,
        memberId: MEMBER_ID,
        bodyMd: "hello",
        bodyHtml: "<p>hello</p>",
        status: "visible",
        hiddenByUserId: null,
        hiddenByMemberId: null,
        hiddenReason: null,
        editedAt: null,
        siteId: "default",
        createdAt: new Date(NOW),
      }).createdAt,
    ).toBe(NOW);
  });

  it("validates enriched comment windows and their pagination invariants", () => {
    const item = npToCommentListItemWire({
      id: COMMENT_ID,
      targetType: "posts",
      targetId: TARGET_ID,
      parentId: null,
      memberId: MEMBER_ID,
      bodyMd: "hello",
      bodyHtml: "<p>hello</p>",
      status: "visible",
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
      editedAt: null,
      siteId: "default",
      createdAt: new Date(NOW),
      author: {
        handle: "member_1",
        displayName: "Member One",
        avatarUrl: "/api/media/avatar",
      },
      reactions: { counts: { like: 2 }, mine: ["like"] },
    });
    expect(
      npRequireCommentListWire({
        comments: [item],
        totalDocs: 2,
        limit: 1,
        offset: 0,
        hasNextPage: true,
        hasPrevPage: false,
      }),
    ).toMatchObject({ totalDocs: 2, limit: 1, offset: 0 });
    expect(() =>
      npRequireCommentListWire({
        comments: [item],
        totalDocs: 1,
        limit: 1,
        offset: 0,
        hasNextPage: true,
        hasPrevPage: false,
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npToCommentListItemWire({
        ...item,
        createdAt: new Date(NOW),
        author: {
          handle: "member_1",
          displayName: "Member One",
          avatarUrl: "javascript:alert(1)",
        },
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npToCommentListItemWire({
        ...item,
        createdAt: new Date(NOW),
        author: {
          handle: "member_1",
          displayName: "Member One",
          avatarUrl: "/\\example.com/avatar.png",
        },
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npRequireCommentListWire({
        comments: [
          {
            ...item,
            reactions: {
              counts: Object.fromEntries(
                Array.from({ length: 33 }, (_, index) => [`kind_${index.toString()}`, 1]),
              ),
              mine: [],
            },
          },
        ],
        totalDocs: 1,
        limit: 1,
        offset: 0,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow(NpCommunityContractError);
  });

  it("validates exact request shapes instead of coercing values", () => {
    expect(npRequireCommentCreateRequest({ bodyMd: "hello" })).toEqual({
      bodyMd: "hello",
      parentId: null,
    });
    expect(npRequireCommentHideRequest({ reason: null })).toEqual({ reason: null });
    expect(npRequireReactionTarget({ targetType: "comment", targetId: COMMENT_ID })).toEqual({
      targetType: "comment",
      targetId: COMMENT_ID,
      kind: "like",
    });
    expect(npRequireReactionTarget({ targetType: "forum-posts", targetId: TARGET_ID })).toEqual({
      targetType: "forum-posts",
      targetId: TARGET_ID,
      kind: "like",
    });
    expect(npRequireFollowTarget({ targetType: "member", targetId: TARGET_ID })).toEqual({
      targetType: "member",
      targetId: TARGET_ID,
    });
    expect(npRequireFollowTarget({ targetType: "forum-posts", targetId: TARGET_ID })).toEqual({
      targetType: "forum-posts",
      targetId: TARGET_ID,
    });
    expect(() =>
      npRequireFollowTarget({ targetType: "Forum posts", targetId: TARGET_ID }),
    ).toThrow();
    expect(() =>
      npRequireReactionTarget({ targetType: "Forum posts", targetId: COMMENT_ID }),
    ).toThrow();
    expect(() =>
      npRequireReactionTarget({ targetType: `a${"b".repeat(63)}`, targetId: COMMENT_ID }),
    ).toThrow(/bounded text/u);
  });

  it("validates exact discoverable moderation scope options", () => {
    expect(
      npRequireCommunityScopeCatalogWire({
        docs: [
          {
            scopeType: "category",
            scopeId: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
            label: "Free board",
            sourceCollection: "forum-boards",
          },
        ],
      }),
    ).toEqual({
      docs: [
        {
          scopeType: "category",
          scopeId: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
          label: "Free board",
          sourceCollection: "forum-boards",
        },
      ],
    });
    expect(() =>
      npRequireCommunityScopeCatalogWire({
        docs: [{ scopeType: "site", scopeId: "default", label: "Site", sourceCollection: "sites" }],
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npRequireCommunityScopeCatalogWire({
        docs: [
          {
            scopeType: "thread",
            scopeId: "not-a-document-id",
            label: "Thread",
            sourceCollection: "forum-posts",
          },
        ],
      }),
    ).toThrow(NpCommunityContractError);
  });

  it("validates the closed thread moderation request contract", () => {
    expect(npRequireThreadModerationRequest({ action: "lock" })).toEqual({ action: "lock" });
    expect(npRequireThreadModerationRequest({ action: "hide", reason: "spam" })).toEqual({
      action: "hide",
      reason: "spam",
    });
    expect(() => npRequireThreadModerationRequest({ action: "publish" })).toThrow(
      NpCommunityContractError,
    );
    expect(() => npRequireThreadModerationRequest({ action: "lock", unexpected: true })).toThrow(
      NpCommunityContractError,
    );
  });

  it("validates local notification destinations and exact follow activity", () => {
    expect(npRequireNotificationHref("/boards/free/post?id=1#comment")).toBe(
      "/boards/free/post?id=1#comment",
    );
    expect(() => npRequireNotificationHref("https://evil.example/post")).toThrow(/local/u);
    expect(() => npRequireNotificationHref("//evil.example/post")).toThrow(/local/u);
    expect(() => npRequireNotificationHref("/boards/free\npost")).toThrow(/local/u);
    expect(
      npRequireFollowActivityNotificationPayload({
        activity: "comment.created",
        subjectType: "forum-posts",
        subjectId: TARGET_ID,
        targetType: "forum-posts",
        targetId: TARGET_ID,
        href: "/boards/free/post",
        commentId: COMMENT_ID,
      }),
    ).toEqual({
      activity: "comment.created",
      subjectType: "forum-posts",
      subjectId: TARGET_ID,
      targetType: "forum-posts",
      targetId: TARGET_ID,
      href: "/boards/free/post",
      commentId: COMMENT_ID,
    });
    expect(() =>
      npRequireFollowActivityNotificationPayload({
        activity: "document.published",
        subjectType: "forum-boards",
        subjectId: TARGET_ID,
        targetType: "forum-posts",
        targetId: TARGET_ID,
        href: "/boards/free/post",
        commentId: COMMENT_ID,
      }),
    ).toThrow(/must be null/u);

    const notification = {
      id: COMMENT_ID,
      memberId: MEMBER_ID,
      kind: "follow.activity",
      payload: {
        activity: "document.published",
        subjectType: "forum-boards",
        subjectId: TARGET_ID,
        targetType: "forum-posts",
        targetId: COMMENT_ID,
        href: "/boards/free/post",
        commentId: null,
      },
      readAt: null,
      siteId: "default",
      createdAt: new Date(NOW),
    };
    expect(npRequireNotificationRow(notification).kind).toBe("follow.activity");
    expect(() =>
      npRequireNotificationRow({
        ...notification,
        payload: { ...notification.payload, unexpected: true },
      }),
    ).toThrow(/unexpected/u);
  });

  it("links report requests, target context, and resolution actions", () => {
    expect(
      npRequireReportRequest({
        targetType: "forum-posts",
        targetId: TARGET_ID,
        reason: "spam",
      }),
    ).toEqual({ targetType: "forum-posts", targetId: TARGET_ID, reason: "spam" });
    expect(npRequireResolveReportRequest({ action: "unpublish-document" })).toEqual({
      action: "unpublish-document",
    });
    expect(() =>
      npRequireResolveReportRequest({ action: "dismiss", resolution: "legacy" }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npRequireReportRequest({
        targetType: "Forum Posts",
        targetId: TARGET_ID,
        reason: "spam",
      }),
    ).toThrow(NpCommunityContractError);

    const report = {
      id: COMMENT_ID,
      reporterId: MEMBER_ID,
      targetType: "forum-posts",
      targetId: TARGET_ID,
      reason: "spam",
      resolvedAt: null,
      resolvedByUserId: null,
      resolvedByMemberId: null,
      resolution: null,
      siteId: "default",
      createdAt: NOW,
      target: {
        kind: "document",
        label: "Reported post",
        excerpt: "Forum post",
        status: "published",
        href: `/admin/collections/forum-posts/${TARGET_ID}`,
        collectionSlug: "forum-posts",
        documentId: TARGET_ID,
        authorMemberId: MEMBER_ID,
      },
    };
    expect(
      npRequireModerationReportPageWire({
        docs: [report],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 50,
        hasNextPage: false,
        hasPrevPage: false,
      }).docs[0]?.target.kind,
    ).toBe("document");
    expect(() =>
      npRequireModerationReportPageWire({
        docs: [{ ...report, target: { ...report.target, href: "https://example.com" } }],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 50,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow(NpCommunityContractError);
    expect(() =>
      npRequireModerationReportPageWire({
        docs: [
          {
            ...report,
            target: { ...report.target, kind: "comment", status: "published" },
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 50,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow(NpCommunityContractError);
  });

  it("validates exact daily view receipts and aggregate invariants", () => {
    expect(
      npRequireContentViewRow({
        id: COMMENT_ID,
        targetType: "forum-posts",
        targetId: TARGET_ID,
        viewerHash: "a".repeat(64),
        viewedOn: "2026-07-20",
        siteId: "default",
        createdAt: new Date(NOW),
      }).viewedOn,
    ).toBe("2026-07-20");
    expect(
      npRequireContentEngagementSummary({
        targetType: "forum-posts",
        targetId: TARGET_ID,
        viewCount: 12,
        commentCount: 3,
        reactionCount: 2,
        reactions: { like: 2 },
      }).reactionCount,
    ).toBe(2);
    expect(npRequireContentViewReceiptWire({ counted: false, viewCount: 12 })).toEqual({
      counted: false,
      viewCount: 12,
    });
    expect(() =>
      npRequireContentEngagementSummary({
        targetType: "forum-posts",
        targetId: TARGET_ID,
        viewCount: 0,
        commentCount: 0,
        reactionCount: 2,
        reactions: { like: 1 },
      }),
    ).toThrow(/sum/u);
    expect(() =>
      npRequireContentViewRow({
        id: COMMENT_ID,
        targetType: "forum-posts",
        targetId: TARGET_ID,
        viewerHash: "raw-cookie",
        viewedOn: "2026-07-20",
        siteId: "default",
        createdAt: new Date(NOW),
      }),
    ).toThrow(/SHA-256/u);
  });

  it("enforces mark-read and pagination limits", () => {
    expect(npRequireMarkNotificationsReadRequest({ all: true })).toEqual({ all: true });
    expect(npRequireCommunityPagination({ limit: 25, page: 2 })).toEqual({
      limit: 25,
      page: 2,
      offset: 25,
    });
    expect(() => npRequireCommunityPagination({ limit: 201, page: 1 })).toThrow();
  });

  it("enforces request invariants for scoped bans", () => {
    expect(
      npRequireBanRequest({
        memberId: MEMBER_ID,
        scopeType: "site",
        kind: "permanent",
      }),
    ).toMatchObject({ scopeId: null, expiresAt: null });
    expect(() =>
      npRequireBanRequest({
        memberId: MEMBER_ID,
        scopeType: "collection",
        kind: "permanent",
      }),
    ).toThrow();
  });

  it("validates aggregate response counts and actor invariants", () => {
    expect(npRequireReactionSummaryWire({ counts: { like: 2 }, mine: ["like"] })).toEqual({
      counts: { like: 2 },
      mine: ["like"],
    });
    expect(() =>
      npRequireReportPageWire({
        docs: [],
        totalDocs: 10,
        totalPages: 1,
        page: 1,
        limit: 5,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow();
    expect(() =>
      npRequireReportPageWire({
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 5,
        hasNextPage: true,
        hasPrevPage: false,
      }),
    ).toThrow();
    expect(() =>
      npRequireReportPageWire({
        docs: [
          {
            id: COMMENT_ID,
            reporterId: MEMBER_ID,
            targetType: "comment",
            targetId: TARGET_ID,
            reason: "spam",
            resolvedAt: NOW,
            resolvedByUserId: null,
            resolvedByMemberId: null,
            resolution: "removed",
            siteId: "default",
            createdAt: NOW,
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 5,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow();
    expect(() =>
      npRequireAuditEventWireRow({
        id: COMMENT_ID,
        actorKind: "system",
        actorUserId: MEMBER_ID,
        actorMemberId: null,
        action: "test",
        targetType: null,
        targetId: null,
        payload: {},
        siteId: null,
        createdAt: NOW,
      }),
    ).toThrow();
  });

  it("validates exact public member profiles and bounded activity pages", () => {
    expect(
      npRequirePublicMemberProfileWire({
        id: MEMBER_ID,
        handle: "member-one",
        displayName: "Member One",
        avatarUrl: "/api/media/avatar",
        bio: "Public bio",
        reputation: -3,
        joinedAt: NOW,
      }),
    ).toMatchObject({ id: MEMBER_ID, reputation: -3 });
    expect(() =>
      npRequirePublicMemberProfileWire({
        id: MEMBER_ID,
        handle: "member-one",
        displayName: "",
        avatarUrl: null,
        bio: null,
        reputation: 0,
        joinedAt: NOW,
      }),
    ).toThrow(/must not be empty/u);

    expect(npRequireMemberProfileActivityQuery({ kind: "documents", page: 2, limit: 20 })).toEqual({
      kind: "documents",
      page: 2,
      limit: 20,
    });
    expect(() =>
      npRequireMemberProfileActivityQuery({ kind: "documents", page: 1, limit: 51 }),
    ).toThrow(/page limit/u);

    expect(
      npRequireMemberProfileActivityPageWire({
        kind: "documents",
        items: [
          {
            kind: "document",
            collectionSlug: "forum-posts",
            collectionLabel: "Forum post",
            documentId: TARGET_ID,
            title: "A public post",
            href: `/boards/free/${TARGET_ID}`,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 20,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toMatchObject({ kind: "documents", totalDocs: 1 });

    expect(() =>
      npRequireMemberProfileActivityPageWire({
        kind: "comments",
        items: [
          {
            kind: "document",
            collectionSlug: "forum-posts",
            collectionLabel: "Forum post",
            documentId: TARGET_ID,
            title: "Wrong item kind",
            href: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 20,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toThrow(/does not match/u);
  });
});
