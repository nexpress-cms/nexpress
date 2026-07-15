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
  npRequireCommunityJsonObject,
  npRequireCommunityPagination,
  npRequireCommunityRoleCatalog,
  npRequireCommunitySettings,
  npRequireCommunitySettingsPatch,
  npRequireFollowTarget,
  npRequireMarkNotificationsReadRequest,
  npRequireNotificationKindCatalog,
  npRequireNotificationPrefs,
  npRequireNotificationPrefsPatch,
  npRequireReactionSummaryWire,
  npRequireRecordAuditEventInput,
  npRequireReactionTarget,
  npRequireReportPageWire,
  npRequireReputationDelta,
  npRequireReputationEvent,
  npRequireRuntimeDiagnostics,
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
    expect(npRequireFollowTarget({ targetType: "member", targetId: TARGET_ID })).toEqual({
      targetType: "member",
      targetId: TARGET_ID,
    });
    expect(() => npRequireReactionTarget({ targetType: "post", targetId: COMMENT_ID })).toThrow();
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
});
