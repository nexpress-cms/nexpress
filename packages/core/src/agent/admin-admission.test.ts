import { describe, expect, it } from "vitest";
import { npValidateAgentStaffPrimaryReauthenticationFactV1 } from "./admin-admission.js";

describe("staff-primary reauthentication facts", () => {
  const now = new Date("2026-09-09T00:05:00.000Z");
  const fact = {
    reauthenticatedAt: "2026-09-09T00:00:00.000Z",
    sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
  };
  it("honors the signed maximum age rather than the default ceiling", () => {
    expect(npValidateAgentStaffPrimaryReauthenticationFactV1(fact, now, 300)).toEqual(fact);
    expect(npValidateAgentStaffPrimaryReauthenticationFactV1(fact, now, 299)).toBeNull();
    expect(
      npValidateAgentStaffPrimaryReauthenticationFactV1(fact, new Date(now.getTime() + 1), 300),
    ).toBeNull();
  });
  it("does not treat a truthy host object as an authentication fact", () => {
    for (const value of [
      true,
      {},
      [],
      { ...fact, accepted: true },
      { ...fact, reauthenticatedAt: "2026-09-09T00:05:01.000Z" },
      { ...fact, reauthenticatedAt: "2026-09-09T00:00:00Z" },
      { ...fact, sessionFactFingerprint: "raw-session-id" },
    ]) {
      expect(npValidateAgentStaffPrimaryReauthenticationFactV1(value, now, 300)).toBeNull();
    }
    let called = false;
    const hostile = { ...fact };
    Object.defineProperty(hostile, "reauthenticatedAt", {
      get() {
        called = true;
        return fact.reauthenticatedAt;
      },
    });
    expect(npValidateAgentStaffPrimaryReauthenticationFactV1(hostile, now, 300)).toBeNull();
    expect(called).toBe(false);
  });
});
