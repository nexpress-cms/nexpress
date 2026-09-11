import { describe, expect, it } from "vitest";
import {
  npAnalyzeAgentRuntimeControlV1,
  npAnalyzeAgentRuntimeOpsResultV1,
  npAnalyzeAgentRuntimeReadinessV1,
  npAnalyzeAgentRuntimeResumePlanV1,
  npAnalyzeAgentRuntimeStatusV1,
  npRequireAgentRuntimeOpsResultV1,
  type NpAgentRuntimeResumePlanV1,
} from "./runtime-ops-contract.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "./runtime-contract.js";
import { npAnalyzeSettingValue, npClassifySettingKey } from "../settings/contract.js";

const hash = `cj1:sha256:${"a".repeat(43)}`;
const plan = (): NpAgentRuntimeResumePlanV1 => ({
  schemaVersion: "np.agent-runtime-resume-plan.v1",
  id: "00000000-0000-4000-8000-000000000001",
  siteId: "default",
  actorFingerprint: hash,
  revision: 1,
  settingsHash: hash,
  readinessFingerprint: hash,
  issuedAt: "2026-09-11T00:00:00.000Z",
  expiresAt: "2026-09-11T00:05:00.000Z",
  planHash: hash,
});
const readiness = () => ({
  doctor: "ready",
  policy: "ready",
  budget: "ready",
  vault: "not-required",
  integrityKey: "ready",
  worker: "ready",
});
const status = () => ({
  schemaVersion: "np.agent-runtime-status.v1",
  siteId: "default",
  revision: 1,
  enabled: true,
  paused: true,
  readiness: readiness(),
  generatedAt: "2026-09-11T00:00:00.000Z",
});

describe("bounded local runtime recovery contract", () => {
  it("admits each exact result state and keeps plans only on plan responses", () => {
    for (const [operation, outcome] of [
      ["status", "status"],
      ["pause", "paused"],
      ["resume-plan", "planned"],
      ["resume", "resumed"],
    ]) {
      expect(
        npRequireAgentRuntimeOpsResultV1({
          schemaVersion: "np.agent-runtime-ops.v1",
          operation,
          outcome,
          errorCode: null,
          status: { ...status(), paused: operation !== "resume" },
          plan: outcome === "planned" ? plan() : null,
        }).outcome,
      ).toBe(outcome);
    }
    expect(
      npAnalyzeAgentRuntimeOpsResultV1({
        schemaVersion: "np.agent-runtime-ops.v1",
        operation: "resume",
        outcome: "blocked",
        errorCode: "RUNTIME_PLAN_INVALID",
        status: null,
        plan: null,
      }).ok,
    ).toBe(true);
  });
  it("rejects invented successful status, unknown authority and raw error details", () => {
    const result = {
      schemaVersion: "np.agent-runtime-ops.v1",
      operation: "resume",
      outcome: "resumed",
      errorCode: null,
      status: status(),
      plan: null,
    };
    expect(npAnalyzeAgentRuntimeOpsResultV1(result).ok).toBe(false);
    for (const key of [
      "credential",
      "locator",
      "rawBody",
      "reason",
      "error",
      "provider",
      "policy",
      "input",
    ])
      expect(npAnalyzeAgentRuntimeStatusV1({ ...status(), [key]: "private" }).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeOpsResultV1({
        ...result,
        outcome: "blocked",
        errorCode: "DATABASE_PASSWORD",
      }).ok,
    ).toBe(false);
  });
  it("requires all six exact readiness checks; only vault may be inapplicable", () => {
    expect(npAnalyzeAgentRuntimeReadinessV1(readiness()).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeReadinessV1({ ...readiness(), policy: "not-required" }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRuntimeReadinessV1({ ...readiness(), worker: null }).ok).toBe(false);
    expect(npAnalyzeAgentRuntimeReadinessV1({ ...readiness(), ready: true }).ok).toBe(false);
  });
  it("bounds plan lifetime, site, revision, actor and canonical time", () => {
    expect(npAnalyzeAgentRuntimeResumePlanV1(plan()).ok).toBe(true);
    for (const patch of [
      { siteId: "*" },
      { revision: 0 },
      { revision: 2 ** 31 },
      { actorFingerprint: "operator@example.com" },
      { issuedAt: "2026-09-11" },
      { expiresAt: "2026-09-11T00:05:00.001Z" },
      { expiresAt: "2026-09-11T00:00:00.000Z" },
      { handler: "run" },
    ])
      expect(npAnalyzeAgentRuntimeResumePlanV1({ ...plan(), ...patch }).ok).toBe(false);
  });
  it("locks pending and consumed control evidence to one revision transition", () => {
    const pending = { revision: 1, currentResumePlan: plan(), lastResumeReceipt: null };
    const receipt = {
      plan: plan(),
      revision: 2,
      settingsHash: hash,
      completedAt: "2026-09-11T00:01:00.000Z",
    };
    expect(npAnalyzeAgentRuntimeControlV1(pending).ok).toBe(true);
    expect(
      npAnalyzeAgentRuntimeControlV1({
        revision: 2,
        currentResumePlan: null,
        lastResumeReceipt: receipt,
      }).ok,
    ).toBe(true);
    expect(npAnalyzeAgentRuntimeControlV1({ ...pending, lastResumeReceipt: receipt }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRuntimeControlV1({ ...pending, revision: 2 }).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeControlV1({
        revision: 2,
        currentResumePlan: null,
        lastResumeReceipt: { ...receipt, completedAt: plan().expiresAt },
      }).ok,
    ).toBe(false);
  });
  it("registers one private runtime control key with the shared exact parser", () => {
    expect(npClassifySettingKey("agents.runtime")).toBe("agents-runtime");
    expect(npClassifySettingKey("agents.runtime.control")).toBe("agents-runtime-control");
    expect(
      npAnalyzeSettingValue("agents.runtime", npCreateDisabledAgentRuntimeSettingsV1()),
    ).toEqual([]);
    expect(
      npAnalyzeSettingValue("agents.runtime.control", {
        revision: 1,
        currentResumePlan: null,
        lastResumeReceipt: null,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeSettingValue("agents.runtime.control", { revision: 1, token: "private" }),
    ).not.toEqual([]);
  });
  it("does not evaluate accessors and rejects unsafe container identities", () => {
    let called = false;
    const unsafe = Object.defineProperty(status(), "credential", {
      enumerable: true,
      get() {
        called = true;
        return "private";
      },
    });
    expect(npAnalyzeAgentRuntimeStatusV1(unsafe).ok).toBe(false);
    expect(called).toBe(false);
    expect(npAnalyzeAgentRuntimeStatusV1({ ...status(), revision: Number.NaN }).ok).toBe(false);
  });
});
