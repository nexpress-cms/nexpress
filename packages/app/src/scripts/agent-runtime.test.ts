import { describe, expect, it, vi } from "vitest";
import type { NpAgentRuntimeControlsV1 } from "@nexpress/core/agents";
import type {
  NpAgentRuntimeOpsResultV1,
  NpAgentRuntimeStatusV1,
  NpAgentRuntimeResumePlanV1,
} from "@nexpress/core/agent-contract";
import { parseAgentRuntimeArgsV1, runAgentRuntimeProcessV1 } from "./agent-runtime.js";

const hash = `cj1:sha256:${"a".repeat(43)}`;
const plan: NpAgentRuntimeResumePlanV1 = {
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
};
const state = (): NpAgentRuntimeStatusV1 => ({
  schemaVersion: "np.agent-runtime-status.v1",
  siteId: "default",
  revision: 1,
  enabled: true,
  paused: true,
  readiness: {
    doctor: "ready",
    policy: "ready",
    budget: "ready",
    vault: "not-required",
    integrityKey: "ready",
    worker: "ready",
  },
  generatedAt: "2026-09-11T00:00:00.000Z",
});
function service() {
  const result = (
    operation: NpAgentRuntimeOpsResultV1["operation"],
    outcome: NpAgentRuntimeOpsResultV1["outcome"],
  ): NpAgentRuntimeOpsResultV1 => ({
    schemaVersion: "np.agent-runtime-ops.v1",
    operation,
    outcome,
    status: { ...state(), paused: outcome !== "resumed" },
    plan: outcome === "planned" ? structuredClone(plan) : null,
    errorCode: null,
  });
  return {
    status: vi
      .fn<NpAgentRuntimeControlsV1["status"]>()
      .mockResolvedValue(result("status", "status")),
    pause: vi.fn<NpAgentRuntimeControlsV1["pause"]>().mockResolvedValue(result("pause", "paused")),
    prepareResume: vi
      .fn<NpAgentRuntimeControlsV1["prepareResume"]>()
      .mockResolvedValue(result("resume-plan", "planned")),
    resume: vi
      .fn<NpAgentRuntimeControlsV1["resume"]>()
      .mockResolvedValue(result("resume", "resumed")),
    requireReadyInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["requireReadyInTransaction"]>()
      .mockResolvedValue(undefined),
    requireDependenciesReadyInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["requireDependenciesReadyInTransaction"]>()
      .mockResolvedValue(undefined),
    updateInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["updateInTransaction"]>()
      .mockResolvedValue(state()),
    pauseInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["pauseInTransaction"]>()
      .mockResolvedValue(state()),
    resumeInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["resumeInTransaction"]>()
      .mockResolvedValue(state()),
    resumeAfterStaffAdmissionInTransaction: vi
      .fn<NpAgentRuntimeControlsV1["resumeAfterStaffAdmissionInTransaction"]>()
      .mockResolvedValue(state()),
  };
}
async function run(
  argv: string[],
  controls = service(),
  extra: Partial<Parameters<typeof runAgentRuntimeProcessV1>[0]> = {},
) {
  const writes: string[] = [];
  const ensureFor = vi.fn(() => Promise.resolve());
  const shutdown = vi.fn(() => Promise.resolve());
  const code = await runAgentRuntimeProcessV1({
    ensureFor,
    shutdown,
    argv,
    resolveRuntimeControls: () => controls,
    output: {
      write: (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    },
    ...extra,
  });
  return { code, output: writes.join(""), ensureFor, shutdown };
}
describe("local Agent runtime CLI", () => {
  it("rejects wildcard sites, unknown flags and incomplete execution before bootstrap", async () => {
    for (const argv of [
      ["status", "--site", "*"],
      ["status", "--site", "default", "--token", "private"],
      ["status", "--site", "default", "--site", "another"],
      ["pause", "--site", "default", "--reason", "maintenance"],
    ]) {
      const result = await run(argv);
      expect(result.code).toBe(1);
      expect(result.ensureFor).not.toHaveBeenCalled();
      expect(result.output).not.toContain("private");
    }
  });
  it("parses only an exact site and the explicit pause ceremony", () => {
    expect(
      parseAgentRuntimeArgsV1([
        "pause",
        "--site",
        "default",
        "--reason",
        "maintenance",
        "--execute",
        "--json",
      ]),
    ).toMatchObject({ operation: "pause", siteId: "default", reason: "maintenance", json: true });
    expect(() =>
      parseAgentRuntimeArgsV1(["resume", "--site", "default", "--plan", "x", "--execute"]),
    ).toThrow("RUNTIME_APPROVAL_REQUIRED");
  });
  it("reuses read bootstrap, emits one bounded object and closes once", async () => {
    const result = await run(["status", "--site", "default", "--json"]);
    expect(result.code).toBe(0);
    expect(result.ensureFor).toHaveBeenCalledWith("read");
    expect(result.shutdown).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.output)).toMatchObject({
      schemaVersion: "np.agent-runtime-ops.v1",
      outcome: "status",
    });
  });
  it("writes a safe persisted-plan projection without putting artifact paths on the wire", async () => {
    const writePlan = vi.fn(() => Promise.resolve());
    const result = await run(
      ["resume", "--site", "default", "--out", "/private/local/plan.json", "--json"],
      service(),
      { writePlan },
    );
    expect(result.code).toBe(0);
    expect(writePlan).toHaveBeenCalledWith("/private/local/plan.json", plan);
    expect(result.output).not.toContain("/private/local");
    expect(JSON.parse(result.output)).toMatchObject({ outcome: "planned", plan });
  });
  it("validates host output before writing any local artifact", async () => {
    const controls = service();
    const original = await controls.prepareResume({ siteId: "default" });
    controls.prepareResume.mockResolvedValue({
      ...original,
      plan: { ...plan, rawCredential: "private-artifact-marker" },
    } as NpAgentRuntimeOpsResultV1);
    const writePlan = vi.fn(() => Promise.resolve());
    const result = await run(
      ["resume", "--site", "default", "--out", "local.json", "--json"],
      controls,
      { writePlan },
    );
    expect(result.code).toBe(1);
    expect(writePlan).not.toHaveBeenCalled();
    expect(result.output).not.toContain("private-artifact-marker");
  });
  it("passes a validated artifact and exact approval to shared resume", async () => {
    const controls = service();
    const result = await run(
      [
        "resume",
        "--site",
        "default",
        "--plan",
        "local.json",
        "--execute",
        "--approve",
        plan.id,
        "--json",
      ],
      controls,
      { readPlan: () => Promise.resolve(structuredClone(plan)) },
    );
    expect(result.code).toBe(0);
    expect(controls.resume).toHaveBeenCalledWith({ siteId: "default", plan, approval: plan.id });
  });
  it("contains raw bootstrap, host, artifact and shutdown errors", async () => {
    const raw = "postgres://private-user:private-password@private-host/private-db";
    const failed = service();
    failed.status.mockRejectedValue(new Error(raw));
    const result = await run(["status", "--site", "default", "--json"], failed);
    expect(result.code).toBe(1);
    expect(result.output).not.toContain(raw);
    expect(result.shutdown).toHaveBeenCalledOnce();
    expect(JSON.parse(result.output)).toMatchObject({
      outcome: "blocked",
      errorCode: "RUNTIME_UNAVAILABLE",
    });
    const artifact = await run(
      ["resume", "--site", "default", "--out", "local.json", "--json"],
      service(),
      {
        writePlan: () => Promise.reject(new Error(raw)),
      },
    );
    expect(artifact.output).not.toContain(raw);
    expect(JSON.parse(artifact.output)).toMatchObject({
      errorCode: "RUNTIME_ARTIFACT_UNAVAILABLE",
    });
  });
});
