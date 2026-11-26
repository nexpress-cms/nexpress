import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npGetGuardianSensitiveObserverV1,
  npGuardianSensitiveMutationActorV1,
  resetGuardianSensitiveObserverV1,
  setGuardianSensitiveObserverV1,
  type NpGuardianSensitiveObserverV1,
} from "./guardian-sensitive-observer.js";

afterEach(resetGuardianSensitiveObserverV1);
const id = "73111111-1111-4111-8111-111111111111";
describe("explicit sensitive mutation observer installation", () => {
  it("is absent by default and captures the installed function table without activating work", () => {
    resetGuardianSensitiveObserverV1();
    expect(npGetGuardianSensitiveObserverV1()).toBeNull();
    const original = vi.fn(() => Promise.resolve()),
      source: NpGuardianSensitiveObserverV1 = {
        prepare: original,
        projectState: () => Promise.reject(new Error("No state should be projected by install")),
        recordCredential: () => Promise.resolve(),
        recordPlugin: () => Promise.resolve(),
      };
    setGuardianSensitiveObserverV1(source);
    source.prepare = vi.fn(() => Promise.resolve());
    expect(npGetGuardianSensitiveObserverV1()?.prepare).toBe(original);
    expect(Object.isFrozen(npGetGuardianSensitiveObserverV1())).toBe(true);
    expect(original).not.toHaveBeenCalled();
    resetGuardianSensitiveObserverV1();
    expect(npGetGuardianSensitiveObserverV1()).toBeNull();
  });
  it("copies honest staff/member/system attribution and rejects malformed or oversized actors", () => {
    const context = { actor: { kind: "staff" as const, userId: id } },
      copied = npGuardianSensitiveMutationActorV1(context, "auth.password-change");
    context.actor.userId = "changed-after-capture";
    expect(copied).toEqual({ kind: "staff", userId: id });
    expect(
      npGuardianSensitiveMutationActorV1(
        { actor: { kind: "member", memberId: id } },
        "auth.member-password-change",
      ),
    ).toEqual({ kind: "member", memberId: id });
    expect(npGuardianSensitiveMutationActorV1(undefined, "ops.plugins")).toEqual({
      kind: "system",
      component: "ops.plugins",
    });
    expect(() => npGuardianSensitiveMutationActorV1(context, "auth.password-change")).toThrow();
    expect(() =>
      npGuardianSensitiveMutationActorV1(
        { actor: { kind: "system", component: "x".repeat(97) } },
        "ops.plugins",
      ),
    ).toThrow();
  });
});
