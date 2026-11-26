import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import vectors from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import type { NpSiteBuildCommandExecutionReceiptV1 } from "./command-executor.js";
import type { NpSiteBuildGeneratorVerificationContextV1 } from "./generator-controller.js";
import { retainSiteBuildGeneratorEvidenceV1 } from "./generator-evidence.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { batchSiteBuildPreviewObservationsV1 } from "./generator-observation-batches.js";
import { publishSiteBuildFinalArtifactsV1 } from "./render-artifacts.js";

const roots: string[] = [];
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function put(root: string, path: string, bytes: Uint8Array | string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-generator-evidence-unit-")));
  roots.push(root);
  const original = join(root, "original"),
    project = join(root, "private");
  for (const path of [original, project])
    await put(path, "src/source.ts", "export const source=1;\n");
  await put(original, ".env", "NP_SYNTHETIC_ONLY=not-an-actual-secret\n");
  const originalSource = await readSiteSourceTreeV1(original),
    candidateSource = await readSiteSourceTreeV1(project);
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      vectors.structured.find((row) => row.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const auditPath = ".nexpress/site/audit/command-executor-unit-1";
  const commands: NpSiteBuildCommandExecutionReceiptV1["commands"] = [];
  for (const [index, command] of blueprint.commands.entries()) {
    const stdout = Buffer.from(`actual owned fixture log ${index}\n`),
      stderr = Buffer.alloc(0);
    const body = {
      schemaVersion: "np.agent-build-command-output.v1" as const,
      stdout: { base64url: stdout.toString("base64url"), truncated: false },
      stderr: { base64url: "", truncated: false },
    };
    const path = `${auditPath}/command-${index}`;
    await put(
      project,
      `${path}.output.json`,
      npBuildCanonicalBytes("np.build-command-output.v1", body).canonicalJsonUtf8,
    );
    await put(project, `${path}.stdout.log`, stdout);
    await put(project, `${path}.stderr.log`, stderr);
    commands.push({
      commandId: command.id,
      template: command.template,
      exitCode: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      execution: {
        id: `command-${index}`,
        argv: ["/usr/local/bin/node", "fixed-owner"],
        exitCode: 0,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1000,
        stdout: { path: `${path}.stdout.log`, sha256: sha(stdout), bytes: stdout.length },
        stderr: { path: `${path}.stderr.log`, sha256: sha(stderr), bytes: 0 },
      },
      outputArtifactPath: `${path}.output.json`,
      outputDigest: await npBuildCanonicalDigest("np.build-command-output.v1", body),
      evidence: null,
    });
  }
  const execution: NpSiteBuildCommandExecutionReceiptV1 = {
    schemaVersion: "np.site-build-command-execution.v1",
    scope: "private-build-copy",
    blueprintHash,
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    baselineTreeDigest: candidateSource.digest,
    generationContext: null,
    generationContextFingerprint: null,
    sourceBefore: candidateSource,
    sourceAfter: candidateSource,
    tools: [],
    drivers: [],
    auditPath,
    commands,
  };
  const context: NpSiteBuildGeneratorVerificationContextV1 = {
    originalProject: original,
    project,
    dependencies: join(root, "unused-dependencies"),
    blueprint,
    blueprintHash,
    originalSource,
    privateBaseline: candidateSource,
    candidateSource,
    editPlan: {
      scope: "private-build-copy",
      blueprintHash,
      baselineTreeDigest: originalSource.digest,
      privateBaselineTreeDigest: candidateSource.digest,
      preservedDirtyPaths: [],
      omittedPaths: [".env"],
      deferredCommandPaths: [],
      files: [],
    },
    execution,
  };
  const saveReceipt = () =>
    put(project, `${auditPath}/receipt.json`, `${JSON.stringify(context.execution)}\n`);
  await saveReceipt();
  const live = vi.fn(() => Promise.resolve()),
    native = vi.fn(() => Promise.resolve());
  const input = {
    context,
    runId: "unit-1",
    assertLiveUnchanged: live,
    observations: [
      {
        kind: "baseline-audit" as const,
        name: "baseline",
        bytes: Buffer.from('{"unitTransportOnly":true}'),
        assertUnchanged: native,
      },
    ],
  };
  return { input, root, original, project, saveReceipt, live, native };
}

// Synthetic execution receipts/live owners exercise validation. Publication uses
// the actual local C compiler/helper; these tests do not claim native render evidence.
describe("generator evidence retention before private cleanup", () => {
  it("retains every 200-route capture and publishes 400 images, report, observation and manifest within unchanged audit bounds", async () => {
    const value = await fixture();
    const captures = Array.from({ length: 400 }, (_, index) =>
      (["final-preview-audit", "seed-receipt"] as const).map((kind) => ({
        kind,
        name: `page-${index}`,
        bytes: Buffer.from(JSON.stringify({ index, kind })),
        assertUnchanged: value.native,
      })),
    ).flat();
    const batches = await batchSiteBuildPreviewObservationsV1(captures);
    const sharedLease = vi.fn(batches[0].assertUnchanged);
    for (const batch of batches) batch.assertUnchanged = sharedLease;
    const retained = await retainSiteBuildGeneratorEvidenceV1({
      ...value.input,
      observations: [...value.input.observations, ...batches],
    });
    // Initial observation, before publication and after publication each check
    // the shared producer/byte lease once, independent of batch count.
    expect(sharedLease).toHaveBeenCalledTimes(3);
    expect(retained.manifest.files.length).toBeLessThanOrEqual(400);
    const preserved = [];
    for (const file of retained.manifest.files.filter(
      (file) => file.kind === "final-preview-audit",
    )) {
      expect(file.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      const envelope = JSON.parse(await readFile(join(value.original, file.path), "utf8"));
      preserved.push(...envelope.segments);
    }
    expect(preserved).toHaveLength(800);
    expect(preserved.map((segment) => Buffer.from(segment.base64url, "base64url"))).toEqual(
      captures.map((entry) => entry.bytes),
    );
    const artifacts = Array.from({ length: 400 }, (_, index) => ({
      path: `.nexpress/site/review/final/page-${index}.png`,
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1EAAAAASUVORK5CYII=",
        "base64",
      ),
    }));
    artifacts.push(
      { path: ".nexpress/site/review/final/report.json", bytes: Buffer.from("{}") },
      { path: ".nexpress/site/review/final/observations-test.json", bytes: Buffer.from("{}") },
    );
    const publication = {
      project: value.original,
      artifacts,
      manifest: { path: ".nexpress/site/review/final/result.json", bytes: Buffer.from("{}") },
    };
    expect((await publishSiteBuildFinalArtifactsV1(publication)).paths).toHaveLength(403);
    expect((await publishSiteBuildFinalArtifactsV1(publication)).status).toBe("unchanged");
    await retained.assertUnchanged();
    await expect(
      publishSiteBuildFinalArtifactsV1({
        ...publication,
        artifacts: [
          ...artifacts,
          { path: ".nexpress/site/review/final/extra.json", bytes: Buffer.from("{}") },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      publishSiteBuildFinalArtifactsV1({
        ...publication,
        artifacts: artifacts.map((item) =>
          item.path.endsWith("observations-test.json")
            ? { ...item, path: ".nexpress/site/review/final/page-extra.png" }
            : item,
        ),
      }),
    ).rejects.toThrow();
  }, 30_000);
  it("retains a deep candidate envelope larger than 4 MiB using only the fixed 8 MiB/depth-24 observation profile", async () => {
    const value = await fixture();
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    const bytes = Buffer.from(
      JSON.stringify({
        candidate: nested,
        padding: Array.from({ length: 10 }, () => "x".repeat(450_000)),
      }),
    );
    value.input.observations[0].bytes = bytes;
    const retained = await retainSiteBuildGeneratorEvidenceV1(value.input);
    const record = retained.retainedArtifacts.find((item) =>
      item.path.endsWith("baseline-audit-baseline.json"),
    )!;
    expect(record.bytes).toBeGreaterThan(4 * 1024 * 1024);
    // Buffer.equals compares every byte without Vitest recursively traversing
    // millions of indexed properties under concurrent CI load.
    expect((await readFile(join(value.original, record.path))).equals(bytes)).toBe(true);
    await retained.assertUnchanged();
  }, 30_000);

  it.each(["bytes", "depth", "duplicate", "receipt"] as const)(
    "rejects widening or malformed evidence at its owning boundary: %s",
    async (kind) => {
      const value = await fixture();
      if (kind === "bytes")
        value.input.observations[0].bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 32);
      if (kind === "depth") {
        let nested: unknown = { leaf: true };
        for (let i = 0; i < 25; i++) nested = { child: nested };
        value.input.observations[0].bytes = Buffer.from(JSON.stringify({ candidate: nested }));
      }
      if (kind === "duplicate")
        value.input.observations[0].bytes = Buffer.from('{"candidate":{"a":1,"\\u0061":2}}');
      if (kind === "receipt")
        Object.defineProperty(value.input.context.execution, "padding", {
          value: "x".repeat(4 * 1024 * 1024),
          enumerable: true,
        });
      await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toBeDefined();
      await expect(
        readFile(join(value.original, ".nexpress/site/audit/generator-unit-1/manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("retains actual command bytes, raw empty/nonempty logs and owner observations; its lease survives cleanup", async () => {
    const value = await fixture(),
      before = await readSiteSourceTreeV1(value.original);
    const retained = await retainSiteBuildGeneratorEvidenceV1(value.input);
    expect(retained.publication.paths.at(-1)).toBe(
      ".nexpress/site/audit/generator-unit-1/manifest.json",
    );
    expect(retained.manifest.scope).toBe("retained-artifacts-only");
    expect(
      retained.manifest.files.find((file) => file.kind === "command-output")?.canonicalDigest,
    ).toBe(value.input.context.execution.commands[0].outputDigest);
    const raw = retained.manifest.files.find((file) => file.kind === "stdout")!;
    expect(await readFile(join(value.original, raw.path))).toEqual(
      await readFile(join(value.project, raw.sourcePath!)),
    );
    expect(retained.manifest.files.find((file) => file.kind === "stderr")?.bytes).toBe(0);
    expect((await readSiteSourceTreeV1(value.original)).digest).toBe(before.digest);
    expect(value.live).toHaveBeenCalled();
    expect(value.native).toHaveBeenCalled();
    await rm(value.project, { recursive: true });
    await retained.assertUnchanged();
    await writeFile(join(value.original, raw.path), "operator replacement");
    await expect(retained.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("retries identical bytes, but never deletes or overwrites a conflicting existing run", async () => {
    const value = await fixture();
    const retained = await retainSiteBuildGeneratorEvidenceV1(value.input);
    expect((await retainSiteBuildGeneratorEvidenceV1(value.input)).publication.status).toBe(
      "unchanged",
    );
    const path = retained.retainedArtifacts[0].path;
    await writeFile(join(value.original, path), "operator bytes");
    await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(await readFile(join(value.original, path), "utf8")).toBe("operator bytes");
    expect(await readFile(join(value.original, "src/source.ts"), "utf8")).toBe(
      "export const source=1;\n",
    );
  });

  it.each([
    "canonical",
    "digest",
    "rawhash",
    "rawbytes",
    "rawprefix",
    "foreign-output",
    "foreign-log",
  ] as const)("rejects mismatched execution evidence: %s", async (kind) => {
    const value = await fixture(),
      command = value.input.context.execution.commands[0];
    const path = command.outputArtifactPath;
    if (kind === "canonical")
      await put(value.project, path, `${await readFile(join(value.project, path), "utf8")}\n`);
    if (kind === "digest") command.outputDigest = `nb1:sha256:${"A".repeat(43)}`;
    if (kind === "rawhash") command.execution!.stdout.sha256 = "a".repeat(64);
    if (kind === "rawbytes") command.execution!.stdout.bytes++;
    if (kind === "foreign-output")
      command.outputArtifactPath = ".nexpress/site/audit/foreign/output.json";
    if (kind === "foreign-log")
      command.execution!.stdout.path = ".nexpress/site/audit/foreign/stdout.log";
    if (kind === "rawprefix") {
      const raw = Buffer.from("other actual bytes\n");
      await put(value.project, command.execution!.stdout.path, raw);
      command.execution!.stdout.sha256 = sha(raw);
      command.execution!.stdout.bytes = raw.length;
    }
    await value.saveReceipt();
    await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toHaveProperty("reason");
    await expect(
      readFile(join(value.original, ".nexpress/site/audit/generator-unit-1/manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["leaf", "parent", "hardlink"] as const)(
    "rejects non-owned command-file aliases: %s",
    async (kind) => {
      const value = await fixture(),
        path = value.input.context.execution.commands[0].outputArtifactPath;
      const outside = join(value.root, "outside.json");
      await writeFile(outside, await readFile(join(value.project, path)));
      if (kind === "parent") {
        const old = dirname(join(value.project, path));
        await rm(old, { recursive: true });
        await symlink(value.root, old);
      } else {
        await rm(join(value.project, path));
        if (kind === "leaf") await symlink(outside, join(value.project, path));
        else await link(outside, join(value.project, path));
      }
      await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toBeDefined();
    },
  );

  it.each(["original", "private", "lease", "producer", "receipt", "observation"] as const)(
    "rejects changed source/producer evidence: %s",
    async (kind) => {
      const value = await fixture();
      if (kind === "original" || kind === "private")
        await put(
          kind === "original" ? value.original : value.project,
          "src/source.ts",
          "mutated source\n",
        );
      if (kind === "lease") value.live.mockRejectedValue(new SiteBuildError("conflict"));
      if (kind === "producer") value.native.mockRejectedValue(new SiteBuildError("conflict"));
      if (kind === "receipt")
        await put(value.project, `${value.input.context.execution.auditPath}/receipt.json`, "{}");
      if (kind === "observation")
        value.input.observations[0].bytes = Buffer.from('{"duplicate":1,"duplicate":2}');
      await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toBeDefined();
    },
  );

  it("requires the host lease and a closed run ID; JSON data alone cannot substitute", async () => {
    const value = await fixture();
    for (const runId of ["../escape", "foreign/run", "x".repeat(81)])
      await expect(
        retainSiteBuildGeneratorEvidenceV1({ ...value.input, runId }),
      ).rejects.toHaveProperty("reason");
    await expect(
      retainSiteBuildGeneratorEvidenceV1({
        ...value.input,
        assertLiveUnchanged: undefined as unknown as () => Promise<void>,
      }),
    ).rejects.toHaveProperty("reason");
  });

  it("rejects a producer lease revoked after publication without deleting retained artifacts", async () => {
    const value = await fixture();
    let calls = 0;
    value.native.mockImplementation(() =>
      ++calls >= 3 ? Promise.reject(new SiteBuildError("conflict")) : Promise.resolve(),
    );
    await expect(retainSiteBuildGeneratorEvidenceV1(value.input)).rejects.toMatchObject({
      reason: "conflict",
    });
    const manifest = await readFile(
      join(value.original, ".nexpress/site/audit/generator-unit-1/manifest.json"),
      "utf8",
    );
    expect(JSON.parse(manifest).scope).toBe("retained-artifacts-only");
    expect(await readFile(join(value.original, "src/source.ts"), "utf8")).toBe(
      "export const source=1;\n",
    );
  });
});
