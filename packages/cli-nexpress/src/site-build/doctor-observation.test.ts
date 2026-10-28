import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import rendererVector from "../../../core/src/build-contract/__fixtures__/renderer-v1.json" with { type: "json" };
import executionVector from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { runSiteBuildLinuxSandboxV1 } from "./linux-sandbox.js";
import { observePreparedSiteBuildDoctorV1 } from "./doctor-observation.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import type { NpSiteBuildCommandObserverContextV1 } from "./command-executor.js";
import { NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1 } from "./render-worker-source.js";

vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: vi.fn() }));
const sandbox = vi.mocked(runSiteBuildLinuxSandboxV1);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  sandbox.mockReset();
});
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "np-doctor-observation-"));
  owned.push(project);
  await writeFile(join(project, "package.json"), '{"name":"doctor-fixture","type":"module"}\n');
  const source = await readSiteSourceTreeV1(project);
  const drafts = npRequireAgentDesignDirectionDraftSetV1(structuredClone(directionVector.draftSet));
  const environment = npRequireAgentBuildRenderEnvironmentV1(
    JSON.parse(executionVector.structured[3].canonical),
  );
  if (environment.sandbox !== "np.linux-build-sandbox.v1")
    throw new Error("Linux fixture required");
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((row) => row.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  blueprint.briefHash = drafts.briefHash;
  blueprint.discoveryFingerprint = drafts.discoveryFingerprint;
  blueprint.selectedDirectionId = drafts.directions[0].id;
  blueprint.selectedDirectionProjectionDigest = await npBuildCanonicalDigest(
    "np.build-design-direction-projection.v1",
    npBuildDirectionProjectionV1(drafts.directions[0]),
  );
  blueprint.commands.push({
    id: "doctor",
    cwd: "project",
    template: "doctor",
    production: false,
    target: null,
    timeoutSeconds: 60,
    prerequisites: ["format"],
  });
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    template: "preview-render",
    timeoutSeconds: 60,
    prerequisites: ["doctor"],
    comparisonInputsDigest: drafts.comparisonInputsDigest,
    renderEnvironmentFingerprint: await npBuildCanonicalDigest(
      "np.build-render-environment.v1",
      environment,
    ),
    routes: drafts.comparisonInputs.informationArchitecture.map(
      ({ pageId, route, locale, audience, fixtureIds }) => ({
        pageId,
        route,
        locale,
        audience,
        fixtureIds,
      }),
    ),
    viewports: drafts.comparisonInputs.viewports,
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: [
      ...drafts.comparisonInputs.informationArchitecture.flatMap(({ pageId }) =>
        (["desktop", "mobile"] as const).map((viewport) => ({
          kind: "screenshot" as const,
          pageId,
          viewport,
          path: `.nexpress/site/review/final/${pageId}-${viewport}.png`,
        })),
      ),
      { kind: "report", path: ".nexpress/site/review/final/report.json" },
    ],
    verificationResultPath: ".nexpress/site/review/final/result.json",
  });
  blueprint.verification.push(
    {
      id: "doctor-exit",
      commandId: "doctor",
      expected: "exit-zero",
      required: true,
      artifactPath: null,
    },
    {
      id: "preview-exit",
      commandId: "preview",
      expected: "exit-zero",
      required: true,
      artifactPath: null,
    },
    {
      id: "preview-review",
      commandId: "preview",
      expected: "review-artifact",
      required: true,
      artifactPath: ".nexpress/site/review/final/result.json",
    },
  );
  const controller = new AbortController();
  const context: NpSiteBuildCommandObserverContextV1 = {
    project,
    dependencies: join(project, "node_modules"),
    blueprint,
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    command: blueprint.commands.find((command) => command.id === "doctor")!,
    source,
    baselineTreeDigest: source.digest,
    timeoutMs: 60_000,
    signal: controller.signal,
    remainingMs: () => 60_000,
    completedCommands: [],
    auditPath: ".nexpress/site/audit/commands-test",
  };
  return {
    context,
    controller,
    brief: directionVector.brief,
    drafts,
    selectedDirectionId: blueprint.selectedDirectionId,
    config: "src/nexpress.config.ts",
    environment,
    capsule: {
      project: "/test-only/frozen-project",
      renderer: npRequireAgentBuildDirectionRendererV1(
        JSON.parse(rendererVector.structured[0].canonical),
      ),
      runtimeFilesDigest: environment.linux.runtimeFilesSha256,
      assertOriginalUnchanged: vi.fn(async () => {}),
    },
    image: {
      schemaVersion: "np.site-build-linux-sandbox-image.v1" as const,
      imageId: environment.linux.imageId,
      baseImageId: environment.linux.imageId,
      recipeDigest: environment.linux.imageRecipeSha256,
      supervisorSha256: environment.linux.supervisor.binarySha256,
      supervisorSourceSha256: environment.linux.supervisor.sourceSha256,
      fontconfigSha256: environment.linux.fontconfigSha256,
      driverFiles: environment.linux.driverFiles,
    },
  };
}
const requiredIds = [
  "node.version",
  "env.file",
  "env.database_url",
  "env.np_secret",
  "env.site_url",
  "routes.contract",
  "i18n.contract",
  "storage.contract",
  "storage.local_directory",
  "database.reachable",
  "auth.contract",
  "settings.contract",
  "collections.contract",
  "migrations.applied",
];
function response(input: Parameters<typeof runSiteBuildLinuxSandboxV1>[0], failed = false) {
  const job = JSON.parse(new TextDecoder().decode(input.inputBytes));
  const checks = requiredIds.map((id) => ({
    id,
    state: failed && id === "database.reachable" ? "error" : "ok",
    label: id === "env.file" ? "Explicit environment input file present" : id,
    ...(id === "env.file" ? { detail: "custom environment input" } : {}),
  }));
  const report = encode({
    schemaVersion: "np.doctor.v1",
    ok: !failed,
    blocksDeploy: failed,
    nextCommand: failed ? "pnpm run doctor -- --fix-plan" : null,
    projectNextCommand: failed ? "nexpress doctor --fix-plan" : null,
    mode: "dev",
    target: null,
    summary: { total: checks.length, errors: Number(failed), warnings: 0 },
    checks,
  });
  return {
    audit: {
      schemaVersion: "np.site-build-linux-audit.v1" as const,
      status: "passed" as const,
      reason: "test-double-only",
      tracedProcesses: 2,
      reapedProcesses: 2,
      descendantsReaped: true,
      argumentsFrozen: true,
      ownIpcReclaimed: true,
      rootExitCode: 0,
      rootSignal: 0,
      forbiddenAttempts: 0,
    },
    artifacts: new Map<string, Uint8Array>([
      ["doctor-report.json", report],
      [
        "doctor-command-output.json",
        encode({
          schemaVersion: "np.agent-build-command-output.v1",
          stdout: {
            base64url: Buffer.concat([report, Buffer.from("\n")]).toString("base64url"),
            truncated: false,
          },
          stderr: { base64url: "", truncated: false },
        }),
      ],
      [
        "seed-materialization.json",
        encode({
          scope: "ordinary-site-build-seed",
          documents: {
            created: job.blueprint.seed.documents.map(
              (row: { documentId: string }) => row.documentId,
            ),
            unchanged: [],
          },
          theme: "written",
          navigation: {
            created: job.blueprint.navigation
              .map((row: { location: string }) => row.location)
              .sort(),
            unchanged: [],
          },
          media: {
            staged: "unsupported-allocated-id-owner-required",
            referenceOnlyRetained: job.blueprint.seed.media.map(
              (row: { mediaId: string }) => row.mediaId,
            ),
            fetched: 0,
            uploaded: 0,
          },
          transaction: "individual-facade-commits",
          pendingCacheInvalidations: [],
          cacheInvalidations: [],
        }),
      ],
    ]),
  };
}

describe("native Doctor observation orchestration (native producer mocked; actual audit filesystem)", () => {
  it("retains actual report/output/seed/audit, forwards cancellation, and detects later evidence tampering", async () => {
    const input = await fixture();
    sandbox.mockImplementation((job) => Promise.resolve(response(job)));
    const result = await observePreparedSiteBuildDoctorV1(input);
    expect(result.exitCode).toBe(0);
    const job = sandbox.mock.calls[0][0];
    expect(job.signal).toBe(input.context.signal);
    expect(JSON.parse(new TextDecoder().decode(job.inputBytes)).mode).toBe("doctor");
    expect(JSON.parse(new TextDecoder().decode(job.inputBytes)).routes).toBeUndefined();
    expect((await readSiteSourceTreeV1(input.context.project)).digest).toBe(
      input.context.source.digest,
    );
    expect(await readFile(join(input.context.project, result.artifacts.report.path))).toEqual(
      Buffer.from(result.artifacts.report.bytes),
    );
    input.controller.abort(); // Completed evidence remains a byte/source lease after its run's timer ends.
    await result.assertUnchanged();
    await writeFile(join(input.context.project, result.artifacts.report.path), "{}");
    await expect(result.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });
  it("retains a genuine failed Doctor report as exit one, without laundering it through native success", async () => {
    const input = await fixture();
    sandbox.mockImplementation((job) => Promise.resolve(response(job, true)));
    const result = await observePreparedSiteBuildDoctorV1(input);
    expect(result.exitCode).toBe(1);
    expect(
      JSON.parse(new TextDecoder().decode(result.artifacts.report.bytes)).checks.find(
        (row: { id: string }) => row.id === "database.reachable",
      ).state,
    ).toBe("error");
  });
  it("rejects source/environment drift and production mode before invoking native execution", async () => {
    const changed = await fixture();
    await writeFile(join(changed.context.project, "package.json"), "{}");
    await expect(observePreparedSiteBuildDoctorV1(changed)).rejects.toMatchObject({
      reason: "conflict",
    });
    const drift = await fixture();
    drift.image.recipeDigest = "f".repeat(64);
    await expect(observePreparedSiteBuildDoctorV1(drift)).rejects.toMatchObject({
      reason: "conflict",
    });
    const prod = await fixture();
    const doctor = prod.context.blueprint.commands.find((command) => command.template === "doctor");
    if (!doctor || doctor.template !== "doctor") throw new Error("doctor fixture");
    doctor.production = true;
    doctor.target = "docker";
    await expect(observePreparedSiteBuildDoctorV1(prod)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("rejects native cleanup failure, skipped checks, mismatched actual stdout and post-run source mutation", async () => {
    const input = await fixture();
    sandbox.mockImplementation((job) => {
      const result = response(job);
      result.audit.ownIpcReclaimed = false;
      return Promise.resolve(result);
    });
    await expect(observePreparedSiteBuildDoctorV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    sandbox.mockImplementation((job) => {
      const result = response(job);
      const report = JSON.parse(
        new TextDecoder().decode(result.artifacts.get("doctor-report.json")),
      );
      report.checks[0].state = "skip";
      result.artifacts.set("doctor-report.json", encode(report));
      return Promise.resolve(result);
    });
    await expect(observePreparedSiteBuildDoctorV1(input)).rejects.toMatchObject({
      reason: "input",
    });
    sandbox.mockImplementation((job) => {
      const result = response(job);
      result.artifacts.set(
        "doctor-command-output.json",
        encode({
          schemaVersion: "np.agent-build-command-output.v1",
          stdout: { base64url: "", truncated: false },
          stderr: { base64url: "", truncated: false },
        }),
      );
      return Promise.resolve(result);
    });
    await expect(observePreparedSiteBuildDoctorV1(input)).rejects.toMatchObject({
      reason: "input",
    });
    sandbox.mockImplementation(async (job) => {
      const result = response(job);
      await writeFile(join(input.context.project, "changed.ts"), "changed");
      return result;
    });
    await expect(observePreparedSiteBuildDoctorV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
  });
  it("parses the complete fixed worker as Node ESM without importing or executing it", async () => {
    // Native/PG proof remains a separate actual gate; parsing does not claim execution.
    const child = spawn(process.execPath, ["--check", "--input-type=module"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (bytes: Buffer) => {
      errors += bytes.toString();
    });
    const closed = new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    child.stdin.end(NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1);
    expect(await closed, errors).toBe(0);
  });
});
