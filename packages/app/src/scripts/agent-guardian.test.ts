import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAgentGuardianControlsV1 } from "@nexpress/core/agents";
import type {
  NpAgentGuardianControlOpsResultV1,
  NpAgentGuardianControlStatusV1,
  NpAgentGuardianEnablePlanV1,
} from "@nexpress/core/agent-contract";
import { parseAgentGuardianArgsV1, runAgentGuardianProcessV1 } from "./agent-guardian.js";

const owners = vi.hoisted(() => ({ runtime: vi.fn(), fallback: vi.fn() }));
vi.mock("@nexpress/core/agents", async () => {
  const actual = await import("../../../core/src/agent/guardian-controls.js");
  return {
    NpAgentGuardianControlError: actual.NpAgentGuardianControlError,
    createAgentGuardianControlsV1: owners.fallback,
    getOptionalAgentStudioServerRuntimeV1: owners.runtime,
  };
});
vi.mock(
  "@nexpress/core/agent-contract",
  async () => import("../../../core/src/agent-contract/guardian-controls-contract.js"),
);
const hash = `cj1:sha256:${"A".repeat(43)}`;
const plan: NpAgentGuardianEnablePlanV1 = {
  schemaVersion: "np.agent-guardian-enable-plan.v1",
  id: "00000000-0000-4000-8000-000000000001",
  siteId: "default",
  actorFingerprint: hash,
  revision: 2,
  controlDigest: hash,
  registrationFingerprint: hash,
  issuedAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-10-18T00:05:00.000Z",
  planHash: hash,
};
const state = (): NpAgentGuardianControlStatusV1 => ({
  schemaVersion: "np.agent-guardian-control-status.v1",
  siteId: "default",
  configured: true,
  revision: 2,
  capture: "disabled",
  registration: { state: "registered", sourceCount: 1, readiness: "ready" },
  response: "separate-policy-required",
  generatedAt: plan.issuedAt,
});
function service() {
  const result = (
    operation: NpAgentGuardianControlOpsResultV1["operation"],
    outcome: NpAgentGuardianControlOpsResultV1["outcome"],
  ): NpAgentGuardianControlOpsResultV1 => ({
    schemaVersion: "np.agent-guardian-control-ops.v1",
    operation,
    outcome,
    errorCode: null,
    status: {
      ...state(),
      ...(outcome === "enabled" ? { capture: "enabled" as const, revision: 3 } : {}),
    },
    plan: outcome === "planned" ? structuredClone(plan) : null,
  });
  return {
    readCaptureAdmission: vi.fn<NpAgentGuardianControlsV1["readCaptureAdmission"]>(),
    requireNewResponseAdmission: vi.fn<NpAgentGuardianControlsV1["requireNewResponseAdmission"]>(),
    statusInTransaction: vi
      .fn<NpAgentGuardianControlsV1["statusInTransaction"]>()
      .mockResolvedValue(state()),
    status: vi
      .fn<NpAgentGuardianControlsV1["status"]>()
      .mockResolvedValue(result("status", "status")),
    disable: vi
      .fn<NpAgentGuardianControlsV1["disable"]>()
      .mockResolvedValue(result("disable", "disabled")),
    prepareEnable: vi
      .fn<NpAgentGuardianControlsV1["prepareEnable"]>()
      .mockResolvedValue(result("enable-plan", "planned")),
    enable: vi
      .fn<NpAgentGuardianControlsV1["enable"]>()
      .mockResolvedValue(result("enable", "enabled")),
  };
}
async function run(
  argv: string[],
  controls = service(),
  extra: Partial<Parameters<typeof runAgentGuardianProcessV1>[0]> = {},
) {
  const writes: string[] = [],
    ensureFor = vi.fn(async () => {}),
    shutdown = vi.fn(async () => {});
  const code = await runAgentGuardianProcessV1({
    argv,
    ensureFor,
    shutdown,
    resolveGuardianControls: () => controls,
    output: {
      write: (value: unknown) => {
        writes.push(String(value));
        return true;
      },
    },
    ...extra,
  });
  return { code, output: writes.join(""), ensureFor, shutdown };
}
const directories: string[] = [];
beforeEach(() => {
  owners.runtime.mockReset().mockReturnValue(null);
  owners.fallback.mockReset();
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("local Guardian recovery CLI", () => {
  it("validates exact site/flags and explicit disable/enable ceremony before bootstrap", async () => {
    for (const argv of [
      ["status", "--site", "*"],
      ["status", "--site", "default", "--token", "private"],
      ["status", "--site", "default", "--site", "other"],
      ["disable", "--site", "default", "--reason", "Contain"],
      ["enable-plan", "--site", "default", "--execute"],
      ["enable", "--site", "default", "--plan", "local.json", "--execute"],
    ]) {
      const result = await run(argv);
      expect(result.code).toBe(1);
      expect(result.ensureFor).not.toHaveBeenCalled();
      expect(result.output).not.toContain("private");
    }
    expect(
      parseAgentGuardianArgsV1(["enable-plan", "--site", "default", "--out", "local.json"]),
    ).toMatchObject({ operation: "enable-plan", outPath: "local.json" });
    expect(
      parseAgentGuardianArgsV1(["enable", "--site", "default", "--out", "local.json"]),
    ).toMatchObject({ operation: "enable-plan" });
  });
  it("uses read bootstrap and shuts down after every attempted bootstrap", async () => {
    const result = await run(["status", "--site", "default", "--json"]);
    expect(result.ensureFor).toHaveBeenCalledWith("read");
    expect(result.shutdown).toHaveBeenCalledOnce();
    expect(JSON.parse(result.output)).toMatchObject({
      schemaVersion: "np.agent-guardian-control-ops.v1",
      outcome: "status",
    });
    const failed = await run(["status", "--site", "default", "--json"], service(), {
      ensureFor: () => Promise.reject(new Error("private-bootstrap-marker")),
    });
    expect(failed.shutdown).toHaveBeenCalledOnce();
    expect(failed.output).not.toContain("private-bootstrap");
  });
  it("prefers installed Studio controls and never enables through an optimistic fallback", async () => {
    const controls = service();
    owners.runtime.mockReturnValue({ guardianControls: controls });
    expect(
      (
        await run(["status", "--site", "default", "--json"], controls, {
          resolveGuardianControls: undefined,
        })
      ).code,
    ).toBe(0);
    expect(controls.status).toHaveBeenCalledOnce();
    expect(owners.fallback).not.toHaveBeenCalled();
    owners.runtime.mockReturnValue(null);
    const result = await run(["enable-plan", "--site", "default", "--json"], controls, {
      resolveGuardianControls: undefined,
    });
    expect(JSON.parse(result.output)).toMatchObject({
      outcome: "blocked",
      errorCode: "GUARDIAN_READINESS_BLOCKED",
    });
    expect(owners.fallback).not.toHaveBeenCalled();
    expect(controls.prepareEnable).not.toHaveBeenCalled();
  });
  it("permits the authority-bound fallback for disable without loading registration/worker/provider owners", async () => {
    const controls = service();
    owners.fallback.mockReturnValue(controls);
    const result = await run(
      ["disable", "--site", "default", "--reason", "Contain", "--execute", "--json"],
      controls,
      { resolveGuardianControls: undefined, env: { NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT: hash } },
    );
    expect(result.code).toBe(0);
    expect(owners.fallback).toHaveBeenCalledWith({ deploymentActorFingerprint: hash });
    expect(controls.disable).toHaveBeenCalledWith({ siteId: "default", reason: "Contain" });
  });
  it("writes only a strict persisted-plan projection and omits artifact paths from output", async () => {
    const writePlan = vi.fn(async () => {}),
      result = await run(
        ["enable-plan", "--site", "default", "--out", "/private/local/plan.json", "--json"],
        service(),
        { writePlan },
      );
    expect(result.code).toBe(0);
    expect(writePlan).toHaveBeenCalledWith("/private/local/plan.json", plan);
    expect(result.output).not.toContain("/private/local");
    const controls = service(),
      original = await controls.prepareEnable({ siteId: "default" });
    controls.prepareEnable.mockResolvedValue({
      ...original,
      plan: Object.assign({ ...plan }, { rawCredential: "private-key-marker" }),
    });
    writePlan.mockClear();
    expect(
      (
        await run(["enable-plan", "--site", "default", "--out", "local.json", "--json"], controls, {
          writePlan,
        })
      ).code,
    ).toBe(1);
    expect(writePlan).not.toHaveBeenCalled();
  });
  it("binds host output and artifacts to the exact requested site and operation", async () => {
    const controls = service(),
      original = await controls.status({ siteId: "default" });
    controls.status.mockResolvedValue({ ...original, status: { ...state(), siteId: "other" } });
    expect((await run(["status", "--site", "default", "--json"], controls)).code).toBe(1);
    const result = await run(
      [
        "enable",
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
      { readPlan: () => Promise.resolve({ ...plan, siteId: "other" }) },
    );
    expect(result.code).toBe(1);
    expect(controls.enable).not.toHaveBeenCalled();
  });
  it("reads and writes bounded local plan files with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "np-guardian-artifact-"));
    directories.push(root);
    const path = join(root, "private", "plan.json"),
      controls = service();
    expect(
      (await run(["enable-plan", "--site", "default", "--out", path, "--json"], controls)).code,
    ).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(plan);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(
      (
        await run(
          [
            "enable",
            "--site",
            "default",
            "--plan",
            path,
            "--execute",
            "--approve",
            plan.id,
            "--json",
          ],
          controls,
        )
      ).code,
    ).toBe(0);
    expect(controls.enable).toHaveBeenCalledWith({ siteId: "default", plan, approval: plan.id });
    await writeFile(path, "x".repeat(4097));
    controls.enable.mockClear();
    const result = await run(
      ["enable", "--site", "default", "--plan", path, "--execute", "--approve", plan.id, "--json"],
      controls,
    );
    expect(JSON.parse(result.output).errorCode).toBe("GUARDIAN_PLAN_INVALID");
    expect(controls.enable).not.toHaveBeenCalled();
  });
  it("contains raw service/artifact/shutdown failures in one bounded result", async () => {
    const controls = service();
    controls.status.mockRejectedValue(
      new Error("postgres://private-user:private-password@private-host/db"),
    );
    const result = await run(["status", "--site", "default", "--json"], controls);
    expect(result.code).toBe(1);
    expect(result.output).not.toContain("private-");
    expect(result.shutdown).toHaveBeenCalledOnce();
    const artifact = await run(
      ["enable-plan", "--site", "default", "--out", "local.json", "--json"],
      service(),
      {
        writePlan: () => Promise.reject(new Error("private-artifact")),
      },
    );
    expect(JSON.parse(artifact.output).errorCode).toBe("GUARDIAN_ARTIFACT_UNAVAILABLE");
    const stopped = await run(["status", "--site", "default", "--json"], service(), {
      shutdown: () => Promise.reject(new Error("private-shutdown")),
    });
    expect(JSON.parse(stopped.output).errorCode).toBe("GUARDIAN_UNAVAILABLE");
    expect(stopped.output).not.toContain("private-shutdown");
  });
});
