import { afterEach, describe, expect, it, vi } from "vitest";

import { getCommunityRuntimeDiagnostics, resetCommunityRuntimeDiagnostics } from "./diagnostics.js";
import { runProfanityCheck, runSpamCheck } from "./moderation.js";
import { setProfanityAdapter } from "./profanity-adapter.js";
import { applyReputation } from "./reputation.js";
import { resetReputationAdapter, setReputationAdapter } from "./reputation-adapter.js";
import { setSpamAdapter } from "./spam-adapter.js";

const context = {
  memberId: "11111111-1111-4111-8111-111111111111",
  targetType: "posts",
  targetId: "22222222-2222-4222-8222-222222222222",
  parentId: null,
};

describe("community moderation adapter boundary", () => {
  afterEach(() => {
    resetCommunityRuntimeDiagnostics();
    resetReputationAdapter();
    vi.restoreAllMocks();
  });

  it("returns a validated detached verdict", async () => {
    const metadata = { score: 0.9 };
    const verdict = await runSpamCheck(
      { check: () => ({ kind: "flag", reason: "Review", metadata }) },
      "body",
      context,
    );
    metadata.score = 0;
    expect(verdict).toEqual({ kind: "flag", reason: "Review", metadata: { score: 0.9 } });
    expect(getCommunityRuntimeDiagnostics()).toEqual([]);
  });

  it("isolates thrown and malformed adapter results as pending flags", async () => {
    const thrown = await runSpamCheck(
      { check: () => Promise.reject(new Error("provider unavailable")) },
      "body",
      context,
    );
    const malformed = await runProfanityCheck(
      { check: () => ({ kind: "allow" }) as never },
      "body",
      context,
    );
    expect(thrown).toEqual({ kind: "flag", reason: "Moderation adapter unavailable" });
    expect(malformed).toEqual({ kind: "flag", reason: "Moderation adapter unavailable" });
    expect(getCommunityRuntimeDiagnostics().map((entry) => entry.source)).toEqual([
      "spam",
      "profanity",
    ]);
  });

  it("diagnoses malformed adapter registrations at registration time", () => {
    expect(() => setSpamAdapter({} as never)).toThrow(/implement check/);
    expect(() => setProfanityAdapter({} as never)).toThrow(/implement check/);
    expect(() => setReputationAdapter({} as never)).toThrow(/implement apply/);
    expect(getCommunityRuntimeDiagnostics().map((entry) => entry.source)).toEqual([
      "spam",
      "profanity",
      "reputation",
    ]);
  });

  it("contains reputation recipient mismatches before adapter dispatch", async () => {
    const apply = vi.fn(() => 1);
    setReputationAdapter({ apply });
    await applyReputation(context.memberId, {
      kind: "reaction.received",
      reactionKind: "like",
      recipientId: "44444444-4444-4444-8444-444444444444",
      reactorId: context.memberId,
      targetType: "comment",
      targetId: context.targetId,
    });
    expect(apply).not.toHaveBeenCalled();
    expect(getCommunityRuntimeDiagnostics()).toEqual([
      expect.objectContaining({
        source: "reputation",
        message: expect.stringContaining("recipient"),
      }),
    ]);
  });
});
