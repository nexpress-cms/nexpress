import { describe, expect, it } from "vitest";

import {
  npAnalyzeAuthUser,
  npAnalyzeMemberSelf,
  npAnalyzeMemberSessionRecord,
  npAnalyzeMemberTokenPayload,
  npAnalyzeStaffSessionRecord,
  npAnalyzeStaffInviteResult,
  npAnalyzeStaffTokenPayload,
  npAnalyzeStaffUserList,
  npIsAuthSingleUseToken,
  npIsAuthNewPassword,
  npIsAuthPasswordCandidate,
  npIsUserRole,
  npMemberStatuses,
  npReadAuthPositiveInteger,
  npRequireAuthSecret,
  npUserRoles,
} from "./index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

describe("auth runtime contract", () => {
  it("owns the closed role and member-status inventories", () => {
    expect(npUserRoles).toEqual(["admin", "editor", "moderator", "author", "viewer"]);
    expect(npMemberStatuses).toEqual(["active", "pending", "suspended", "deleted", "imported"]);
    expect(npIsUserRole("editor")).toBe(true);
    expect(npIsUserRole("owner")).toBe(false);
  });

  it("fails closed for malformed or out-of-range auth integers", () => {
    expect(npReadAuthPositiveInteger("TTL", undefined, 10, 100)).toBe(10);
    expect(npReadAuthPositiveInteger("TTL", "42", 10, 100)).toBe(42);
    for (const value of ["0", "-1", "1.5", " 2", "2 ", "1e2", "101"]) {
      expect(() => npReadAuthPositiveInteger("TTL", value, 10, 100)).toThrow();
    }
    expect(() => npReadAuthPositiveInteger("TTL", undefined, 101, 100)).toThrow("fallback");
  });

  it("recognizes only exact single-use credential tokens", () => {
    expect(npIsAuthSingleUseToken("a".repeat(64))).toBe(true);
    expect(npIsAuthSingleUseToken("A".repeat(64))).toBe(false);
    expect(npIsAuthSingleUseToken("a".repeat(63))).toBe(false);
  });

  it("bounds login candidates and newly accepted passwords", () => {
    expect(npIsAuthPasswordCandidate("short")).toBe(true);
    expect(npIsAuthNewPassword("short")).toBe(false);
    expect(npIsAuthNewPassword("long-enough")).toBe(true);
    expect(npIsAuthPasswordCandidate("x".repeat(1025))).toBe(false);
    expect(npIsAuthNewPassword("x".repeat(1025))).toBe(false);
  });

  it("rejects weak or oversized signing secrets", () => {
    expect(npRequireAuthSecret("x".repeat(32))).toBe("x".repeat(32));
    expect(() => npRequireAuthSecret("short")).toThrow("32 through 1024");
    expect(() => npRequireAuthSecret("x".repeat(1025))).toThrow("32 through 1024");
  });

  it("accepts exact persisted auth users and rejects aliases or unknown fields", () => {
    expect(
      npAnalyzeAuthUser({
        id: userId,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        tokenVersion: 0,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeAuthUser({
        id: userId,
        email: "Admin@example.com",
        name: "Admin",
        role: "owner",
        tokenVersion: -1,
        extra: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "user.email" }),
        expect.objectContaining({ path: "user.role" }),
        expect.objectContaining({ path: "user.tokenVersion" }),
        expect.objectContaining({ path: "user.extra", code: "unknown-field" }),
      ]),
    );
  });

  it("pins exact JWT claims for both audiences", () => {
    const staff = {
      sub: userId,
      aud: "staff",
      ver: 0,
      use: "access",
      sid: sessionId,
      jti: "abcdefghijklmnopqrstuv",
      iat: 100,
      exp: 200,
    };
    expect(npAnalyzeStaffTokenPayload(staff)).toEqual([]);
    expect(npAnalyzeMemberTokenPayload({ ...staff, sub: memberId, aud: "member" })).toEqual([]);
    expect(npAnalyzeStaffTokenPayload({ ...staff, aud: "member", role: "admin" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "token.aud" }),
        expect.objectContaining({ path: "token.role", code: "unknown-field" }),
      ]),
    );
    expect(npAnalyzeStaffTokenPayload({ ...staff, exp: 100 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "token.exp", code: "invariant" })]),
    );
  });

  it("validates one exact database row per access/refresh session pair", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    const accessExpiresAt = new Date("2026-07-14T02:00:00.000Z");
    const refreshExpiresAt = new Date("2026-07-21T00:00:00.000Z");
    const base = {
      id: sessionId,
      accessTokenHash: "a".repeat(64),
      refreshTokenHash: "b".repeat(64),
      accessExpiresAt,
      refreshExpiresAt,
      userAgent: null,
      ip: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(npAnalyzeStaffSessionRecord({ ...base, userId })).toEqual([]);
    expect(npAnalyzeMemberSessionRecord({ ...base, memberId })).toEqual([]);
    expect(
      npAnalyzeStaffSessionRecord({
        ...base,
        userId,
        refreshTokenHash: "a".repeat(64),
        refreshExpiresAt: new Date("2026-07-14T01:00:00.000Z"),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "staffSession.refreshTokenHash", code: "invariant" }),
        expect.objectContaining({ path: "staffSession.refreshExpiresAt", code: "invariant" }),
      ]),
    );
    expect(
      npAnalyzeStaffSessionRecord({
        ...base,
        userId,
        accessExpiresAt: now,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "staffSession.accessExpiresAt", code: "invariant" }),
      ]),
    );
  });

  it("validates exact Admin and member self wire shapes", () => {
    expect(
      npAnalyzeStaffUserList({
        docs: [
          {
            id: userId,
            email: "admin@example.com",
            name: "Admin",
            role: "admin",
            avatar: null,
            createdAt: "2026-07-14T00:00:00.000Z",
            updatedAt: "2026-07-14T00:00:00.000Z",
          },
        ],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 20,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeMemberSelf({
        id: memberId,
        handle: "member_1",
        email: "member@example.com",
        displayName: "Member",
        emailVerified: true,
        avatar: null,
        bio: null,
        status: "active",
        reputation: -3,
        createdAt: "2026-07-14T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeMemberSelf({
        id: memberId,
        handle: "member_1",
        email: "member@example.com",
        displayName: "Member",
        emailVerified: true,
        avatar: null,
        bio: null,
        status: "suspended",
        reputation: 0,
        createdAt: "2026-07-14T00:00:00.000Z",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "member.status", code: "invariant" }),
      ]),
    );
    expect(
      npAnalyzeStaffInviteResult({
        id: userId,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        inviteExpiresAt: "2026-07-21T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStaffUserList({
        docs: [],
        totalDocs: 1,
        totalPages: 0,
        page: 1,
        limit: 20,
        hasNextPage: false,
        hasPrevPage: false,
      }).some((issue) => issue.path === "users.totalPages" && issue.code === "invariant"),
    ).toBe(true);
  });
});
