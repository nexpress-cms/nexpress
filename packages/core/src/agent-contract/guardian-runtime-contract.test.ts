import { describe, expect, it } from "vitest";
import {
  npAgentGuardianRuntimeRuleBoundsV1,
  npEvaluateAgentGuardianRuntimeRulesV1,
  npRequireAgentGuardianRuntimeActivityV1,
  npRequireAgentGuardianRuntimeEventPayloadV1,
  npRequireAgentGuardianRuntimeEvidenceV1,
  npRequireAgentGuardianRuntimeSourceReceiptV1,
  type NpAgentGuardianRuntimeActivityV1,
  type NpAgentGuardianRuntimeFactV1,
  type NpAgentGuardianRuntimeRuleMatchV1,
} from "./guardian-runtime-contract.js";

const startedAt = "2026-10-18T00:00:00.000Z";
const occurredAt = "2026-10-18T00:01:00.000Z";
function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
function digest(n = 1): string {
  return `cj1:sha256:${n.toString(16).padEnd(43, "A")}`;
}
function activity(fact: NpAgentGuardianRuntimeFactV1, n = 1): NpAgentGuardianRuntimeActivityV1 {
  return {
    schemaVersion: "np.agent-guardian-runtime-activity.v1",
    observationId: id(n),
    siteId: "default",
    agentId: id(1000),
    agentVersionId: id(1001),
    runId: id(1002),
    principalId: id(1003),
    runAdmissionDigest: digest(1004),
    occurredAt,
    fact,
  };
}
function repeated(n = 1): NpAgentGuardianRuntimeActivityV1 {
  return activity(
    {
      kind: "proposal-repeated",
      capabilityId: "content.query",
      proposalDigest: digest(2000),
      responses: [
        { providerCallId: id(201), sequence: 1, responseDigest: digest(201) },
        { providerCallId: id(202), sequence: 2, responseDigest: digest(202) },
      ],
    },
    n,
  );
}
function denied(n: number): NpAgentGuardianRuntimeActivityV1 {
  return activity(
    {
      kind: "scope-denied",
      capabilityId: "changeset.apply",
      missingScopes: ["changeset:apply"],
      response: { providerCallId: id(200 + n), sequence: n, responseDigest: digest(200 + n) },
    },
    n,
  );
}
function action(n: number): NpAgentGuardianRuntimeActivityV1 {
  return activity(
    {
      kind: "action-admitted",
      actionId: id(300 + n),
      sequence: n,
      actionDigest: digest(300 + n),
      capabilityId: "content.query",
    },
    n,
  );
}
function cost(
  n: number,
  amount: number,
  source: "provider" | "adapter-estimate" = "provider",
): NpAgentGuardianRuntimeActivityV1 {
  return activity(
    {
      kind: "provider-cost",
      providerCallId: id(400 + n),
      reservationId: id(500 + n),
      sequence: n,
      requestDigest: digest(400 + n),
      responseDigest: digest(500 + n),
      phase: "reconciled",
      currency: "USD",
      accounting: {
        state: "settled",
        costSource: source,
        costMicros: amount,
        budgetChargeCostMicros: amount,
      },
    },
    n,
  );
}
function unknown(n: number, charge: number): NpAgentGuardianRuntimeActivityV1 {
  const value = cost(n, 0);
  if (value.fact.kind !== "provider-cost") throw new Error("fixture");
  value.fact.phase = "ambiguous";
  value.fact.accounting = {
    state: "unknown",
    costSource: "unknown",
    costMicros: null,
    budgetChargeCostMicros: charge,
  };
  return value;
}
function evaluate(
  activities: NpAgentGuardianRuntimeActivityV1[],
): NpAgentGuardianRuntimeRuleMatchV1[] {
  return npEvaluateAgentGuardianRuntimeRulesV1({
    siteId: "default",
    agentId: id(1000),
    windowStartedAt: startedAt,
    activities,
  });
}
function evidence(match: NpAgentGuardianRuntimeRuleMatchV1) {
  const { observationIds, ...safe } = match;
  expect(observationIds.length).toBeGreaterThan(0);
  return {
    schemaVersion: "np.agent-guardian-runtime-evidence.v1",
    signalId: id(9000),
    ...safe,
    sourceDigest: digest(9000),
  };
}

describe("Guardian committed Runtime source contract", () => {
  it("copies four closed fact kinds and rejects raw inputs, provider prose or invented execution outcomes", () => {
    for (const value of [repeated(), denied(1), action(1), cost(1, 10), unknown(1, 50)]) {
      const parsed = npRequireAgentGuardianRuntimeActivityV1(value);
      expect(parsed).toEqual(value);
      expect(parsed).not.toBe(value);
      expect(parsed.fact).not.toBe(value.fact);
      for (const extra of [
        { input: "private" },
        { prompt: "ignore approval" },
        { connection: { secret: "private" } },
        { actor: { kind: "system", component: "claimed" } },
      ])
        expect(() => npRequireAgentGuardianRuntimeActivityV1({ ...value, ...extra })).toThrow();
    }
    const admitted = action(1);
    expect(() =>
      npRequireAgentGuardianRuntimeActivityV1({
        ...admitted,
        fact: { ...admitted.fact, succeeded: true },
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianRuntimeActivityV1({
        ...admitted,
        fact: { kind: "CAPABILITY_UNAVAILABLE" },
      }),
    ).toThrow();
  });

  it("requires an actual ordered repeated pair and known nonempty sorted missing scopes", () => {
    const value = repeated();
    if (value.fact.kind !== "proposal-repeated") throw new Error("fixture");
    const [first, second] = value.fact.responses;
    for (const responses of [
      [],
      [first],
      [first, { ...second, providerCallId: first.providerCallId }],
      [second, first],
    ])
      expect(() =>
        npRequireAgentGuardianRuntimeActivityV1({ ...value, fact: { ...value.fact, responses } }),
      ).toThrow();
    const rejected = denied(1);
    for (const missingScopes of [
      [],
      ["content:read", "content:read"],
      ["content:read", "changeset:apply"],
      ["deployment:admin"],
    ])
      expect(() =>
        npRequireAgentGuardianRuntimeActivityV1({
          ...rejected,
          fact: { ...rejected.fact, missingScopes },
        }),
      ).toThrow();
  });

  it("preserves unknown cost and exact reservation accounting instead of converting charge to spend", () => {
    expect(npRequireAgentGuardianRuntimeActivityV1(unknown(1, 900_000)).fact).toMatchObject({
      accounting: { state: "unknown", costMicros: null, budgetChargeCostMicros: 900_000 },
    });
    const value = cost(1, 10);
    if (value.fact.kind !== "provider-cost") throw new Error("fixture");
    for (const accounting of [
      { state: "unknown", costSource: "unknown", costMicros: 0, budgetChargeCostMicros: 10 },
      { state: "settled", costSource: "unknown", costMicros: 10, budgetChargeCostMicros: 10 },
      { state: "settled", costSource: "provider", costMicros: 10, budgetChargeCostMicros: 11 },
      { state: "released", costSource: null, costMicros: null, budgetChargeCostMicros: 1 },
    ])
      expect(() =>
        npRequireAgentGuardianRuntimeActivityV1({ ...value, fact: { ...value.fact, accounting } }),
      ).toThrow();
    expect(() =>
      npRequireAgentGuardianRuntimeActivityV1({
        ...value,
        fact: { ...value.fact, phase: "ambiguous" },
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianRuntimeActivityV1({
        ...value,
        fact: { ...value.fact, currency: "EUR" },
      }),
    ).toThrow();
    const released = {
      ...value,
      fact: {
        ...value.fact,
        phase: "late-reconciled",
        accounting: {
          state: "released",
          costSource: null,
          costMicros: null,
          budgetChargeCostMicros: 0,
        },
      },
    };
    expect(npRequireAgentGuardianRuntimeActivityV1(released).fact).toMatchObject({
      accounting: { state: "released", costSource: null, costMicros: null },
    });
  });

  it("binds Event and receipt identities but treats MAC parsing as shape validation only", () => {
    const value = repeated();
    const payload = {
      kind: "agent.runtime.activity.observed",
      receiptId: value.observationId,
      activity: value,
    };
    expect(npRequireAgentGuardianRuntimeEventPayloadV1(payload)).toEqual(payload);
    expect(() =>
      npRequireAgentGuardianRuntimeEventPayloadV1({ ...payload, receiptId: id(99) }),
    ).toThrow();
    const receipt = {
      schemaVersion: "np.agent-guardian-runtime-receipt.v1",
      receiptId: value.observationId,
      keyId: "local:v1",
      bodyHash: digest(88),
      sourceMac: `hmac-sha256:${"A".repeat(43)}`,
      activity: value,
    };
    // A well-shaped MAC and digest do not authenticate these invented fixture bytes.
    expect(npRequireAgentGuardianRuntimeSourceReceiptV1(receipt)).toEqual(receipt);
    for (const extra of [
      { receiptId: id(99) },
      { sourceMac: "unsigned" },
      { keyId: "bad key" },
      { secret: "not allowed" },
    ])
      expect(() =>
        npRequireAgentGuardianRuntimeSourceReceiptV1({ ...receipt, ...extra }),
      ).toThrow();
  });

  it("keeps a missing cost response hash null without inventing structured proposal proof or call identity", () => {
    for (const value of [unknown(1, 100_000), cost(1, 100_000)]) {
      if (value.fact.kind !== "provider-cost") throw new Error("fixture");
      value.fact.responseDigest = null;
      expect(npRequireAgentGuardianRuntimeActivityV1(value).fact).toMatchObject({
        responseDigest: null,
      });
      expect(() =>
        npRequireAgentGuardianRuntimeActivityV1({
          ...value,
          fact: { ...value.fact, providerCallId: null },
        }),
      ).toThrow();
    }
    const deniedValue = denied(1);
    if (deniedValue.fact.kind !== "scope-denied") throw new Error("fixture");
    const deniedFact = deniedValue.fact;
    expect(() =>
      npRequireAgentGuardianRuntimeActivityV1({
        ...deniedValue,
        fact: {
          ...deniedFact,
          response: { ...deniedFact.response, responseDigest: null },
        },
      }),
    ).toThrow();
  });

  it("rejects unsafe object graphs without invoking getters", () => {
    let reads = 0;
    const value = repeated();
    Object.defineProperty(value, "fact", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    expect(() => npRequireAgentGuardianRuntimeActivityV1(value)).toThrow();
    expect(reads).toBe(0);
    const shared = repeated();
    if (shared.fact.kind !== "proposal-repeated") throw new Error("fixture");
    shared.fact.responses[1] = shared.fact.responses[0];
    expect(() => npRequireAgentGuardianRuntimeActivityV1(shared)).toThrow();
  });
});

describe("Guardian fixed Runtime review rules", () => {
  it("matches the existing two-response repeat blocker without requiring unreachable five-turn loops", () => {
    expect(npAgentGuardianRuntimeRuleBoundsV1.repeatedProposalCount).toBe(2);
    expect(evaluate([repeated()])).toEqual([
      {
        detectorId: "guardian.repeated-proposals",
        detectorVersion: 1,
        window: { startedAt, endedAt: occurredAt },
        basis: "verified-repeated-proposal-pair",
        observedCount: 2,
        countBasis: "at-least",
        assessment: "review-only",
        accounting: null,
        observationIds: [id(1)],
      },
    ]);
  });

  it("requires five distinct denied provider calls and five distinct admitted Actions", () => {
    for (const factory of [denied, action]) {
      expect(evaluate(Array.from({ length: 4 }, (_, n) => factory(n + 1)))).toEqual([]);
      const values = Array.from({ length: 6 }, (_, n) => factory(n + 1));
      const [match] = evaluate(values);
      expect(match.observedCount).toBe(5);
      expect(match.observationIds).toEqual(values.slice(0, 5).map((entry) => entry.observationId));
      expect(evaluate([...values].reverse())).toEqual([match]);
    }
  });

  it("does not inflate thresholds through observation replay or entity aliases", () => {
    for (const factory of [denied, action]) {
      const original = factory(1);
      expect(evaluate(Array.from({ length: 5 }, () => structuredClone(original)))).toEqual([]);
      expect(
        evaluate(
          Array.from({ length: 5 }, (_, n) => ({
            ...structuredClone(original),
            observationId: id(n + 1),
          })),
        ),
      ).toEqual([]);
    }
    const original = action(1),
      changed = structuredClone(original);
    if (changed.fact.kind !== "action-admitted") throw new Error("fixture");
    changed.fact.actionDigest = digest(8000);
    expect(() => evaluate([original, changed])).toThrow();
    changed.observationId = id(2);
    expect(() => evaluate([original, changed])).toThrow();
  });

  it("fails closed on contradictory Run, provider call or Action sequence bindings", () => {
    expect(() => evaluate([action(1), { ...action(2), principalId: id(999) }])).toThrow();
    const second = action(2);
    if (second.fact.kind !== "action-admitted") throw new Error("fixture");
    second.fact.sequence = 1;
    expect(() => evaluate([action(1), second])).toThrow();
    const secondCall = denied(2);
    if (secondCall.fact.kind !== "scope-denied") throw new Error("fixture");
    secondCall.fact.response.sequence = 1;
    expect(() => evaluate([denied(1), secondCall])).toThrow();
    expect(() =>
      evaluate([denied(1), { ...denied(2), runAdmissionDigest: digest(999) }]),
    ).toThrow();
  });

  it("uses exact site and Agent fixed UTC windows with at most one hundred retained observations", () => {
    for (const change of [
      { siteId: "other" },
      { agentId: id(999) },
      { occurredAt: "2026-10-17T23:59:59.999Z" },
      { occurredAt: "2026-10-18T00:10:00.000Z" },
    ])
      expect(() => evaluate([{ ...action(1), ...change }])).toThrow();
    expect(() =>
      npEvaluateAgentGuardianRuntimeRulesV1({
        siteId: "default",
        agentId: id(1000),
        windowStartedAt: occurredAt,
        activities: [],
      }),
    ).toThrow();
    expect(evaluate(Array.from({ length: 100 }, (_, n) => action(n + 1)))[0].countBasis).toBe(
      "at-least",
    );
    expect(() => evaluate(Array.from({ length: 101 }, (_, n) => action(n + 1)))).toThrow();
    expect(evaluate([{ ...repeated(), occurredAt: startedAt }])[0].window).toEqual({
      startedAt,
      endedAt: startedAt,
    });
  });

  it("counts known settled USD spend while keeping reported, estimated and unknown accounting separate", () => {
    expect(evaluate([cost(1, 99_999)])).toEqual([]);
    expect(evaluate([unknown(1, 900_000_000)])).toEqual([]);
    const [match] = evaluate([
      cost(1, 40_000),
      cost(2, 60_000, "adapter-estimate"),
      unknown(3, 900_000),
    ]);
    expect(match).toMatchObject({
      detectorId: "guardian.spend-velocity",
      observedCount: 3,
      accounting: {
        reportedCallCount: 1,
        reportedCostMicros: 40_000,
        estimatedCallCount: 1,
        estimatedCostMicros: 60_000,
        knownCostMicros: 100_000,
        unknownCallCount: 1,
        unknownBudgetChargeMicros: 900_000,
        releasedCallCount: 0,
      },
    });
    expect(npRequireAgentGuardianRuntimeEvidenceV1(evidence(match)).assessment).toBe("review-only");
  });

  it("supersedes same-call unknown accounting with late settlement or a true release, even at the same millisecond", () => {
    const pending = unknown(1, 900_000),
      late = cost(1, 100_000);
    // Ordering by observation UUID must not overrule the actual accounting phase.
    pending.observationId = id(99);
    if (late.fact.kind !== "provider-cost") throw new Error("fixture");
    late.fact.phase = "late-reconciled";
    expect(evaluate([pending, late])).toEqual(evaluate([late, pending]));
    expect(evaluate([pending, late])[0]).toMatchObject({
      observedCount: 1,
      observationIds: [late.observationId],
      accounting: { knownCostMicros: 100_000, unknownCallCount: 0, unknownBudgetChargeMicros: 0 },
    });
    const other = cost(2, 50_000);
    other.observationId = id(50);
    const expected = evaluate([pending, other, late]);
    for (const order of [
      [late, pending, other],
      [other, late, pending],
      [other, pending, late],
      [pending, late, other],
      [late, other, pending],
    ])
      expect(evaluate(order)).toEqual(expected);
    const released = structuredClone(late);
    released.fact = {
      ...late.fact,
      accounting: {
        state: "released",
        costSource: null,
        costMicros: null,
        budgetChargeCostMicros: 0,
      },
    };
    expect(evaluate([pending, released])).toEqual([]);
    const [match] = evaluate([pending, released, cost(2, 100_000)]);
    expect(match.accounting).toMatchObject({
      knownCostMicros: 100_000,
      releasedCallCount: 1,
      unknownCallCount: 0,
      unknownBudgetChargeMicros: 0,
    });
  });

  it("does not double-count known same-call facts and rejects contradictory terminal or regressed accounting", () => {
    const first = cost(1, 60_000),
      replay = { ...structuredClone(first), observationId: id(2) };
    expect(evaluate([first, replay])).toEqual([]);
    const conflict = { ...cost(1, 70_000), observationId: id(3) };
    expect(() => evaluate([first, conflict])).toThrow();
    const regressed = unknown(1, 500_000);
    regressed.observationId = id(4);
    regressed.occurredAt = "2026-10-18T00:02:00.000Z";
    expect(() => evaluate([first, regressed])).toThrow();
    const rebound = { ...structuredClone(first), observationId: id(5) };
    if (rebound.fact.kind !== "provider-cost") throw new Error("fixture");
    rebound.fact.reservationId = id(999);
    expect(() => evaluate([first, rebound])).toThrow();
    expect(() => evaluate([cost(1, Number.MAX_SAFE_INTEGER), cost(2, 1)])).toThrow();
  });

  it("projects review-only lower bounds without raw principals, execution targets, scopes or proposal input", () => {
    const matches = [
      ...evaluate([repeated()]),
      ...evaluate(Array.from({ length: 5 }, (_, n) => denied(n + 1))),
      ...evaluate(Array.from({ length: 5 }, (_, n) => action(n + 1))),
      ...evaluate([cost(1, 100_000)]),
    ];
    expect(matches).toHaveLength(4);
    for (const match of matches) {
      const safe = evidence(match);
      expect(npRequireAgentGuardianRuntimeEvidenceV1(safe)).toEqual(safe);
      for (const extra of [
        { agentId: id(1000) },
        { runId: id(1002) },
        { principalId: id(1003) },
        { actionId: id(301) },
        { missingScopes: ["content:read"] },
        { proposalDigest: digest(2000) },
        { countBasis: "total" },
        { assessment: "attack-confirmed" },
        { observationIds: match.observationIds },
      ])
        expect(() => npRequireAgentGuardianRuntimeEvidenceV1({ ...safe, ...extra })).toThrow();
      expect(() =>
        npRequireAgentGuardianRuntimeEvidenceV1({
          ...safe,
          window: { startedAt, endedAt: "2026-10-18T00:10:00.000Z" },
        }),
      ).toThrow();
    }
  });

  it("rejects invented summary totals or an unknown conservative charge relabeled as known spend", () => {
    const [match] = evaluate([cost(1, 100_000)]);
    const safe = evidence(match);
    for (const accounting of [
      { ...match.accounting, reportedCostMicros: 100_001 },
      { ...match.accounting, knownCostMicros: 99_999, reportedCostMicros: 99_999 },
      { ...match.accounting, reportedCallCount: 0 },
      { ...match.accounting, unknownBudgetChargeMicros: 1 },
      { ...match.accounting, totalCostMicros: 100_000 },
    ])
      expect(() => npRequireAgentGuardianRuntimeEvidenceV1({ ...safe, accounting })).toThrow();
    expect(() => npRequireAgentGuardianRuntimeEvidenceV1({ ...safe, observedCount: 2 })).toThrow();
    expect(() =>
      npRequireAgentGuardianRuntimeEvidenceV1({ ...safe, basis: "admitted-actions" }),
    ).toThrow();
  });
});
