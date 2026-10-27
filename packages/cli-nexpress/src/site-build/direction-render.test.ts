import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildInstalledCatalogDigestV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentDesignDirectionDraftSetV1,
} from "@nexpress/core/agent-contract";
import directionVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import rendererVector from "../../../core/src/build-contract/__fixtures__/renderer-v1.json" with { type: "json" };
import executionVector from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxSandboxImageV1,
} from "./linux-sandbox.js";
import { fingerprintSiteBuildBrowserRequestPolicyV1 } from "./render-observation.js";
import {
  observeSiteBuildRenderPathsV1,
  renderPreparedSiteBuildDirectionsV1,
  validatePreparedSiteBuildDirectionsV1,
} from "./direction-render.js";

vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: vi.fn() }));
const sandbox = vi.mocked(runSiteBuildLinuxSandboxV1),
  roots: string[] = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const catalog = JSON.parse(rendererVector.catalog.canonical);
const audit = {
  schemaVersion: "np.site-build-linux-audit.v1" as const,
  status: "passed" as const,
  reason: "unit-test-double",
  tracedProcesses: 1,
  reapedProcesses: 1,
  descendantsReaped: true,
  argumentsFrozen: true,
  ownIpcReclaimed: true,
  rootExitCode: 0,
  rootSignal: 0,
  forbiddenAttempts: 0,
};

// Independent simple PNG fixture; tests below verify orchestration, not browser/native acceptance.
function png(width = 240, height = 240): Buffer {
  const crc = (data: Buffer) => {
    let n = 0xffffffff;
    for (const byte of data) {
      n ^= byte;
      for (let b = 0; b < 8; b++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    out.write(type, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1), 255);
  for (let y = 0; y < height; y++) rows[y * (width * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function fixture() {
  const drafts = npRequireAgentDesignDirectionDraftSetV1(structuredClone(directionVector.draftSet));
  const fingerprint = await npBuildInstalledCatalogDigestV1(catalog);
  drafts.discoveryFingerprint = fingerprint;
  drafts.comparisonInputs.projectionInputs.discoveryFingerprint = fingerprint;
  drafts.comparisonInputs.informationArchitecture[0].locale = "ko";
  drafts.comparisonInputs.sampleContent[0].locale = "ko";
  drafts.comparisonInputs.viewports = {
    desktop: { width: 240, height: 240, deviceScaleFactor: 1 },
    mobile: { width: 240, height: 240, deviceScaleFactor: 1 },
  };
  drafts.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    drafts.comparisonInputs,
  );
  for (const direction of drafts.directions) {
    direction.discoveryFingerprint = fingerprint;
    direction.comparisonInputsDigest = drafts.comparisonInputsDigest;
  }
  const environment = npRequireAgentBuildRenderEnvironmentV1(
    JSON.parse(executionVector.structured[3].canonical),
  );
  if (environment.sandbox !== "np.linux-build-sandbox.v1") throw new Error("test Linux vector");
  environment.viewports = drafts.comparisonInputs.viewports;
  const paths = {
    allowedPaths: ["/"],
    requestPolicy: {
      documentPaths: ["/"],
      imagePaths: [],
      imageWidths: [640],
      imageQualities: [75],
    },
  };
  environment.linux.requestPolicy.sha256 = fingerprintSiteBuildBrowserRequestPolicyV1(
    paths.requestPolicy,
  );
  const capsule = {
    project: "/unit-test-only/project",
    renderer: npRequireAgentBuildDirectionRendererV1(
      JSON.parse(rendererVector.structured[0].canonical),
    ),
    runtimeFilesDigest: environment.linux.runtimeFilesSha256,
    assertOriginalUnchanged: vi.fn(async () => {}),
  };
  const image: NpSiteBuildLinuxSandboxImageV1 = {
    schemaVersion: "np.site-build-linux-sandbox-image.v1",
    imageId: environment.linux.imageId,
    baseImageId: environment.linux.imageId,
    recipeDigest: environment.linux.imageRecipeSha256,
    supervisorSha256: environment.linux.supervisor.binarySha256,
    supervisorSourceSha256: environment.linux.supervisor.sourceSha256,
    fontconfigSha256: environment.linux.fontconfigSha256,
    driverFiles: environment.linux.driverFiles,
  };
  return {
    brief: directionVector.brief,
    drafts,
    config: "src/nexpress.config.ts",
    capsule,
    image,
    environment,
    paths,
  };
}
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "np-render-orchestration-test-"));
  roots.push(root);
  return root;
}
beforeEach(() => {
  sandbox.mockReset();
  sandbox.mockImplementation(async (input) => {
    await Promise.resolve();
    const job = JSON.parse(new TextDecoder().decode(input.inputBytes));
    return {
      audit,
      artifacts: new Map(
        job.mode === "catalog" ? [["catalog.json", encode(catalog)]] : [["page-000.png", png()]],
      ),
    };
  });
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("trusted direction orchestration (native/browser calls doubled)", () => {
  it("stops after a cancelled catalog and never launches a browser page", async () => {
    const input = await fixture(),
      controller = new AbortController();
    sandbox.mockImplementationOnce((job) => {
      expect(job.signal).toBe(controller.signal);
      controller.abort();
      return Promise.resolve({ audit, artifacts: new Map([["catalog.json", encode(catalog)]]) });
    });
    await expect(
      renderPreparedSiteBuildDirectionsV1({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).toHaveBeenCalledTimes(1);
  });

  it("awaits active page cleanup and stops the direction/viewport loop on cancellation", async () => {
    const input = await fixture(),
      controller = new AbortController();
    const started = deferred<void>(),
      cleanup = deferred<void>();
    sandbox.mockImplementationOnce(() =>
      Promise.resolve({
        audit,
        artifacts: new Map([["catalog.json", encode(catalog)]]),
      }),
    );
    sandbox.mockImplementationOnce(async (job) => {
      expect(job.signal).toBe(controller.signal);
      started.resolve();
      await new Promise<void>((resolve) =>
        job.signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      await cleanup.promise;
      throw new SiteBuildError("unavailable");
    });
    let settled = false;
    const failed = renderPreparedSiteBuildDirectionsV1({
      ...input,
      signal: controller.signal,
    }).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    cleanup.resolve();
    expect(await failed).toMatchObject({ reason: "unavailable" });
    expect(sandbox).toHaveBeenCalledTimes(2);
  });

  it("does not reset the remaining budget for each native page", async () => {
    const input = await fixture();
    let remaining = 100;
    await expect(
      renderPreparedSiteBuildDirectionsV1({
        ...input,
        remainingMs: () => remaining,
        progress: () => {
          remaining = 0;
        },
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).toHaveBeenCalledTimes(1);
  });
  it("runs six fresh page jobs and binds all six montages/receipts to their exact sources", async () => {
    const input = await fixture(),
      result = await renderPreparedSiteBuildDirectionsV1(input);
    expect(sandbox).toHaveBeenCalledTimes(7);
    expect(result.artifacts).toHaveLength(12);
    expect(result.receipts).toHaveLength(6);
    expect(new Set(result.artifacts.map((item) => item.path)).size).toBe(12);
    expect(result.set.directions.map((item) => item.id)).toEqual(
      input.drafts.directions.map((item) => item.id),
    );
    for (const call of sandbox.mock.calls.slice(1)) {
      const job = JSON.parse(new TextDecoder().decode(call[0].inputBytes));
      expect(job.routes).toEqual([{ pageId: "home", path: "/", audience: "public", locale: "ko" }]);
      expect(job.mode).toBe("render");
      expect(job.renderer).toEqual(input.capsule.renderer);
    }
    expect(input.capsule.assertOriginalUnchanged).toHaveBeenCalledTimes(7);
  });
  it("rerenders before checking persisted evidence, then rejects changed image bytes", async () => {
    const input = await fixture(),
      result = await renderPreparedSiteBuildDirectionsV1(input),
      root = await directory();
    for (const item of result.artifacts) {
      await mkdir(dirname(join(root, item.path)), { recursive: true });
      await writeFile(join(root, item.path), item.bytes);
    }
    sandbox.mockClear();
    await expect(
      validatePreparedSiteBuildDirectionsV1({
        ...input,
        sealedSet: result.set,
        artifactProject: root,
      }),
    ).resolves.toMatchObject({ set: result.set });
    expect(sandbox).toHaveBeenCalledTimes(7);
    await writeFile(join(root, result.artifacts[0].path), "tampered");
    sandbox.mockClear();
    await expect(
      validatePreparedSiteBuildDirectionsV1({
        ...input,
        sealedSet: result.set,
        artifactProject: root,
      }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(sandbox).toHaveBeenCalledTimes(7);
  });
  it("cannot render a stale runtime/environment or finite request policy", async () => {
    const input = await fixture();
    input.capsule.runtimeFilesDigest = "0".repeat(64);
    await expect(renderPreparedSiteBuildDirectionsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(sandbox).not.toHaveBeenCalled();
    const changed = await fixture();
    changed.paths.requestPolicy.imageWidths = [750];
    await expect(renderPreparedSiteBuildDirectionsV1(changed)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("rejects a changed live catalog before any image job", async () => {
    const input = await fixture();
    input.drafts.discoveryFingerprint = "ndc1:sha256:" + "A".repeat(43);
    input.drafts.comparisonInputs.projectionInputs.discoveryFingerprint =
      input.drafts.discoveryFingerprint;
    input.drafts.comparisonInputsDigest = await npBuildCanonicalDigest(
      "np.build-design-comparison-inputs.v1",
      input.drafts.comparisonInputs,
    );
    for (const d of input.drafts.directions) {
      d.discoveryFingerprint = input.drafts.discoveryFingerprint;
      d.comparisonInputsDigest = input.drafts.comparisonInputsDigest;
    }
    await expect(renderPreparedSiteBuildDirectionsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(sandbox).toHaveBeenCalledTimes(1);
  });
  it("cannot seal a failed job or a PNG whose dimensions do not match the viewport", async () => {
    const input = await fixture();
    sandbox.mockRejectedValueOnce(new SiteBuildError("unavailable"));
    await expect(renderPreparedSiteBuildDirectionsV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    sandbox.mockResolvedValueOnce({
      audit,
      artifacts: new Map([["catalog.json", encode(catalog)]]),
    });
    sandbox.mockResolvedValueOnce({ audit, artifacts: new Map([["page-000.png", png(241, 240)]]) });
    await expect(renderPreparedSiteBuildDirectionsV1(input)).rejects.toMatchObject({
      reason: "input",
    });
  });
  it("observes only finite normal static/public paths and rejects links", async () => {
    const root = await directory();
    await mkdir(join(root, ".next/static/chunks"), { recursive: true });
    await mkdir(join(root, "public"));
    await writeFile(join(root, ".next/static/chunks/site.js"), "test");
    await writeFile(join(root, "public/logo.svg"), "test");
    const observed = await observeSiteBuildRenderPathsV1(root, ["/ko"]);
    expect(observed.allowedPaths).toEqual(["/_next/static/chunks/site.js", "/ko", "/logo.svg"]);
    expect(observed.requestPolicy.imagePaths).toEqual(["/logo.svg"]);
    await symlink("logo.svg", join(root, "public/alias.svg"));
    await expect(observeSiteBuildRenderPathsV1(root, ["/ko"])).rejects.toMatchObject({
      reason: "path",
    });
  });
});
