import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { NpAuthError } from "../errors.js";
import { signMemberToken, verifyMemberToken } from "./member-token.js";
import { signToken, verifyToken } from "./token.js";

const secret = "auth-contract-test-secret-at-least-32-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

describe("auth JWT contract", () => {
  it("mints exact purpose-bound staff and member claims", async () => {
    const staff = await signToken(
      { id: userId, tokenVersion: 2 },
      secret,
      300,
      "access",
      sessionId,
    );
    const member = await signMemberToken(
      { id: memberId, tokenVersion: 4 },
      secret,
      600,
      "refresh",
      sessionId,
    );

    await expect(verifyToken(staff, secret, "access")).resolves.toEqual(
      expect.objectContaining({
        sub: userId,
        aud: "staff",
        ver: 2,
        use: "access",
        sid: sessionId,
      }),
    );
    await expect(verifyMemberToken(member, secret, "refresh")).resolves.toEqual(
      expect.objectContaining({
        sub: memberId,
        aud: "member",
        ver: 4,
        use: "refresh",
        sid: sessionId,
      }),
    );
    await expect(verifyMemberToken(staff, secret, "access")).rejects.toThrow();
    await expect(verifyToken(member, secret, "refresh")).rejects.toThrow();
  });

  it("rejects legacy, unknown, and wrong-purpose claims", async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const malformed = await new SignJWT({
      ver: 0,
      use: "access",
      sid: sessionId,
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setAudience("staff")
      .setJti("abcdefghijklmnopqrstuv")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(new TextEncoder().encode(secret));
    const legacy = await new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setAudience("staff")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(new TextEncoder().encode(secret));
    const refresh = await signToken(
      { id: userId, tokenVersion: 0 },
      secret,
      300,
      "refresh",
      sessionId,
    );

    await expect(verifyToken(malformed, secret)).rejects.toBeInstanceOf(NpAuthError);
    await expect(verifyToken(legacy, secret)).rejects.toBeInstanceOf(NpAuthError);
    await expect(verifyToken(refresh, secret, "access")).rejects.toBeInstanceOf(NpAuthError);
  });

  it("rejects non-positive token lifetimes before signing", async () => {
    await expect(signToken({ id: userId, tokenVersion: 0 }, secret, 0)).rejects.toThrow(
      "positive integer",
    );
    await expect(signMemberToken({ id: memberId, tokenVersion: 0 }, secret, 1.5)).rejects.toThrow(
      "positive integer",
    );
  });
});
