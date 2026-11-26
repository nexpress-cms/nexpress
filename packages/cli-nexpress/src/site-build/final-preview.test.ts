import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
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
import { canonicalizeSiteBuildPngV1 } from "./png-canonicalizer.js";
import { fingerprintSiteBuildBrowserRequestPolicyV1 } from "./render-observation.js";
import {
  renderPreparedSiteBuildFinalPreviewV1,
  type NpSiteBuildFinalPreviewProgressV1,
} from "./final-preview.js";
import { SiteBuildError } from "./artifact-io.js";

vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: vi.fn() }));
const sandbox = vi.mocked(runSiteBuildLinuxSandboxV1);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const audit = {
  schemaVersion: "np.site-build-linux-audit.v1" as const,
  status: "passed" as const,
  reason: "test-double-only",
  tracedProcesses: 1,
  reapedProcesses: 1,
  descendantsReaped: true,
  argumentsFrozen: true,
  ownIpcReclaimed: true,
  rootExitCode: 0,
  rootSignal: 0,
  forbiddenAttempts: 0,
};
// Hand-built pixel fixture, then canonical codec. These are orchestration tests,
// not Chromium/HTTP/native sandbox execution or seed-reconciliation evidence.
const images = new Map<string, Uint8Array>();
function png(width: number, height: number): Uint8Array {
  const key = `${width}x${height}`;
  const existing = images.get(key);
  if (existing) return existing;
  const crc = (data: Buffer) => {
    let n = 0xffffffff;
    for (const byte of data) {
      n ^= byte;
      for (let i = 0; i < 8; i++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length);
    output.write(type, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc(output.subarray(4, -4)), output.length - 4);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1), 255);
  for (let y = 0; y < height; y++) rows[y * (width * 4 + 1)] = 0;
  const result = canonicalizeSiteBuildPngV1(
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  images.set(key, result);
  return result;
}
async function refreshDraft(drafts: ReturnType<typeof npRequireAgentDesignDirectionDraftSetV1>) {
  drafts.discoveryFingerprint = drafts.comparisonInputs.projectionInputs.discoveryFingerprint;
  drafts.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    drafts.comparisonInputs,
  );
  for (const direction of drafts.directions) {
    direction.discoveryFingerprint = drafts.discoveryFingerprint;
    direction.comparisonInputsDigest = drafts.comparisonInputsDigest;
  }
}
async function fixture() {
  const reviewedDrafts = npRequireAgentDesignDirectionDraftSetV1(
    structuredClone(directionVector.draftSet),
  );
  reviewedDrafts.comparisonInputs.viewports = {
    desktop: { width: 240, height: 240, deviceScaleFactor: 1 },
    mobile: { width: 240, height: 260, deviceScaleFactor: 2 },
  };
  reviewedDrafts.comparisonInputs.informationArchitecture.push({
    pageId: "member",
    route: "/member",
    locale: "en",
    audience: "member",
    purpose: "Member information",
    fixtureIds: [],
  });
  for (const direction of reviewedDrafts.directions)
    direction.pageBindings.push({
      pageId: "member",
      source: "custom",
      patternId: null,
      overrides: null,
      templateId: "home",
      blocks: [],
    });
  await refreshDraft(reviewedDrafts);
  const drafts = structuredClone(reviewedDrafts);
  drafts.comparisonInputs.projectionInputs.discoveryFingerprint = "fixture:current-catalog:v1";
  await refreshDraft(drafts);
  const environment = npRequireAgentBuildRenderEnvironmentV1(
    JSON.parse(executionVector.structured[3].canonical),
  );
  if (environment.sandbox !== "np.linux-build-sandbox.v1")
    throw new Error("test Linux environment");
  environment.viewports = reviewedDrafts.comparisonInputs.viewports;
  const paths = {
    allowedPaths: ["/", "/member"],
    requestPolicy: {
      documentPaths: ["/", "/member"],
      imagePaths: [],
      imageWidths: [640],
      imageQualities: [75],
    },
  };
  environment.linux.requestPolicy.sha256 = fingerprintSiteBuildBrowserRequestPolicyV1(
    paths.requestPolicy,
  );
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((e) => e.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  blueprint.briefHash = reviewedDrafts.briefHash;
  blueprint.discoveryFingerprint = reviewedDrafts.discoveryFingerprint;
  blueprint.selectedDirectionId = reviewedDrafts.directions[0].id;
  blueprint.selectedDirectionProjectionDigest = await npBuildCanonicalDigest(
    "np.build-design-direction-projection.v1",
    npBuildDirectionProjectionV1(reviewedDrafts.directions[0]),
  );
  blueprint.pages = reviewedDrafts.comparisonInputs.informationArchitecture.map((page) => ({
    id: page.pageId,
    route: page.route,
    locale: page.locale,
    audience: page.audience,
    source: "custom",
    patternId: null,
    patternOverrides: null,
    templateId: "home",
    blocks: [],
  }));
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 60,
    template: "preview-render",
    comparisonInputsDigest: reviewedDrafts.comparisonInputsDigest,
    renderEnvironmentFingerprint: await npBuildCanonicalDigest(
      "np.build-render-environment.v1",
      environment,
    ),
    routes: reviewedDrafts.comparisonInputs.informationArchitecture.map(
      ({ pageId, route, locale, audience, fixtureIds }) => ({
        pageId,
        route,
        locale,
        audience,
        fixtureIds,
      }),
    ),
    viewports: reviewedDrafts.comparisonInputs.viewports,
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: [
      ...blueprint.pages.flatMap((page) =>
        (["desktop", "mobile"] as const).map((viewport) => ({
          kind: "screenshot" as const,
          pageId: page.id,
          viewport,
          path: `.nexpress/site/review/final/${page.id}-${viewport}.png`,
        })),
      ),
      { kind: "report", path: ".nexpress/site/review/final/report.json" },
    ],
    verificationResultPath: ".nexpress/site/review/final/result.json",
  });
  blueprint.verification.push(
    {
      id: "preview-exit",
      commandId: "preview",
      required: true,
      expected: "exit-zero",
      artifactPath: null,
    },
    {
      id: "preview-review",
      commandId: "preview",
      required: true,
      expected: "review-artifact",
      artifactPath: ".nexpress/site/review/final/result.json",
    },
  );
  return {
    brief: directionVector.brief,
    reviewedDrafts,
    drafts,
    selectedDirectionId: blueprint.selectedDirectionId,
    blueprint,
    config: "src/nexpress.config.ts",
    defaultLocale: "ko" as string | null,
    environment,
    paths,
    capsule: {
      project: "/unit-only/readonly-project",
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
function response(input: Parameters<typeof runSiteBuildLinuxSandboxV1>[0]) {
  const job = JSON.parse(new TextDecoder().decode(input.inputBytes));
  const route = job.routes[0];
  const common = {
    schemaVersion: "np.site-build-browser-preview-observation.v1",
    themePackage: "@nexpress/theme-default",
    route: route.path,
    locale: route.locale,
    metadataOwner: route.audience === "member" ? "forum-member" : "page",
    routeMatches: true,
  };
  return {
    audit,
    artifacts: new Map<string, Uint8Array>([
      [
        "seed-materialization.json",
        encode({
          scope: "ordinary-site-build-seed",
          documents: {
            created: job.blueprint.seed.documents.map(
              (document: { documentId: string }) => document.documentId,
            ),
            unchanged: [],
          },
          theme: "written",
          navigation: {
            created: job.blueprint.navigation.map(
              (navigation: { location: string }) => navigation.location,
            ),
            unchanged: [],
          },
          media: {
            staged: "unsupported-allocated-id-owner-required",
            referenceOnlyRetained: job.blueprint.seed.media.map(
              (media: { mediaId: string }) => media.mediaId,
            ),
            fetched: 0,
            uploaded: 0,
          },
          transaction: "individual-facade-commits",
          pendingCacheInvalidations: [],
          cacheInvalidations: [],
        }),
      ],
      [
        "page-000.png",
        png(
          job.viewport.width * job.viewport.deviceScaleFactor,
          job.viewport.height * job.viewport.deviceScaleFactor,
        ),
      ],
      [
        "preview-checks-000.json",
        encode({
          schemaVersion: "np.site-build-page-preview-observations.v1",
          pageId: route.pageId,
          route: route.path,
          locale: route.locale,
          audience: route.audience,
          status: 200,
          document: {
            ...common,
            phase: "document",
            complete: true,
            metadata: { missing: false, invalid: false },
            accessibility: [],
            overflow: { root: false, controls: false },
            links: [],
          },
          interaction: { ...common, phase: "interaction", supported: true, passed: true },
        }),
      ],
    ]),
  };
}
beforeEach(() => {
  sandbox.mockReset();
  sandbox.mockImplementation((input) => Promise.resolve(response(input)));
});

describe("final all-route preview coordinator (native/browser transport doubled)", () => {
  it("forwards cancellation, awaits the active job cleanup, and starts no later route", async () => {
    const input = await fixture(),
      controller = new AbortController();
    const started = deferred<void>(),
      cleanup = deferred<void>();
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
    const failed = renderPreparedSiteBuildFinalPreviewV1({
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
    expect(sandbox).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation after progress and the shared remaining budget before dispatch", async () => {
    const input = await fixture(),
      controller = new AbortController();
    await expect(
      renderPreparedSiteBuildFinalPreviewV1({
        ...input,
        signal: controller.signal,
        progress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).not.toHaveBeenCalled();
    let remaining = 100;
    await expect(
      renderPreparedSiteBuildFinalPreviewV1({
        ...input,
        remainingMs: () => remaining,
        progress: () => {
          remaining = 0;
        },
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).not.toHaveBeenCalled();
  });

  it("rejects a late active-job result instead of starting another viewport", async () => {
    const input = await fixture(),
      controller = new AbortController();
    const progress: NpSiteBuildFinalPreviewProgressV1[] = [];
    sandbox.mockImplementationOnce((job) => {
      controller.abort();
      return Promise.resolve(response(job));
    });
    await expect(
      renderPreparedSiteBuildFinalPreviewV1({
        ...input,
        signal: controller.signal,
        observeProgress: (event) => progress.push(event),
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toEqual({
      phase: "native-completed",
      pageId: "home",
      viewport: "desktop",
      completedCaptures: 0,
      nativeAudit: audit,
    });
  });
  it.each(["missing", "different-documents"] as const)(
    "requires fresh exact seed materialization evidence: %s",
    async (mutation) => {
      const input = await fixture();
      sandbox.mockImplementationOnce((job) => {
        const result = response(job);
        if (mutation === "missing") result.artifacts.delete("seed-materialization.json");
        else {
          const receipt = JSON.parse(
            new TextDecoder().decode(result.artifacts.get("seed-materialization.json")),
          );
          receipt.documents.created.push("unplanned-document");
          result.artifacts.set("seed-materialization.json", encode(receipt));
        }
        return Promise.resolve(result);
      });
      await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toMatchObject({
        reason: "input",
      });
      expect(sandbox).toHaveBeenCalledTimes(1);
    },
  );

  it("runs every route at both physical viewport sizes, keeps distinct current lineage, and hashes every actual artifact", async () => {
    const input = await fixture();
    const progress: NpSiteBuildFinalPreviewProgressV1[] = [];
    const result = await renderPreparedSiteBuildFinalPreviewV1({
      ...input,
      observeProgress: (event) => progress.push(event),
    });
    expect(result.status).toBe("passed");
    expect(
      progress.filter((event) => event.phase === "capture").map((event) => event.completedCaptures),
    ).toEqual([1, 2, 3, 4]);
    expect(progress.filter((event) => event.nativeAudit !== null)).toHaveLength(4);
    expect(progress.at(-1)).toMatchObject({ phase: "final-lease", completedCaptures: 4 });
    expect(sandbox).toHaveBeenCalledTimes(4);
    expect(
      sandbox.mock.calls.map(
        ([call]) => JSON.parse(new TextDecoder().decode(call.inputBytes)).routes[0],
      ),
    ).toEqual([
      { pageId: "home", path: "/", audience: "public", locale: "ko" },
      { pageId: "home", path: "/", audience: "public", locale: "ko" },
      { pageId: "member", path: "/member", audience: "member", locale: "en" },
      { pageId: "member", path: "/member", audience: "member", locale: "en" },
    ]);
    for (const [call] of sandbox.mock.calls) {
      const job = JSON.parse(new TextDecoder().decode(call.inputBytes));
      expect(job.mode).toBe("final-render");
      expect(job.drafts).toEqual(input.drafts);
      expect(job.blueprint).toEqual(input.blueprint);
      expect(call.artifacts).toEqual([
        { name: "page-000.png", maxBytes: 10 * 1024 * 1024 },
        { name: "preview-checks-000.json", maxBytes: 3 * 1024 * 1024 },
        { name: "seed-materialization.json", maxBytes: 1024 * 1024 },
      ]);
    }
    expect(result.artifacts).toHaveLength(5);
    expect(result.audits).toHaveLength(4);
    expect(result.report.comparisonInputsDigest).toBe(input.reviewedDrafts.comparisonInputsDigest);
    expect(result.lineage.currentComparisonInputsDigest).not.toBe(
      result.lineage.reviewedComparisonInputsDigest,
    );
    expect(result.lineage.currentSelectedProjectionDigest).not.toBe(
      result.lineage.reviewedSelectedProjectionDigest,
    );
    for (const record of result.artifactRecords) {
      const artifact = result.artifacts.find((item) => item.path === record.path)!;
      expect(record.bytes).toBe(artifact.bytes.length);
      expect(record.digest).toBe(
        await npBuildFileDigest("np.build-verification-artifact.v1", artifact.bytes),
      );
    }
    expect(input.capsule.assertOriginalUnchanged).toHaveBeenCalledTimes(10);
  });
  it("retains failed checks and their screenshot evidence instead of turning actual check failures into parser failures", async () => {
    sandbox.mockImplementation((input) => {
      const result = response(input);
      const capture = JSON.parse(
        new TextDecoder().decode(result.artifacts.get("preview-checks-000.json")),
      );
      capture.document.overflow.root = true;
      result.artifacts.set("preview-checks-000.json", encode(capture));
      return Promise.resolve(result);
    });
    const result = await renderPreparedSiteBuildFinalPreviewV1(await fixture());
    expect(result.status).toBe("failed");
    expect(result.artifacts).toHaveLength(5);
    expect(result.report.issues.every((issue) => issue.code === "LAYOUT_OVERFLOW")).toBe(true);
    expect(result.report.issues[0].evidenceArtifactPaths).toHaveLength(2);
  });
  it("rejects stale environment/image/runtime/request policy and source leases before any native work", async () => {
    for (const mutate of [
      (input: Awaited<ReturnType<typeof fixture>>) => {
        input.environment.browser.version = "155.0.0.1";
      },
      (input: Awaited<ReturnType<typeof fixture>>) => {
        input.image.supervisorSha256 = "a".repeat(64);
      },
      (input: Awaited<ReturnType<typeof fixture>>) => {
        input.capsule.runtimeFilesDigest = "a".repeat(64);
      },
      (input: Awaited<ReturnType<typeof fixture>>) => {
        input.paths.requestPolicy.imageWidths = [750];
      },
      (input: Awaited<ReturnType<typeof fixture>>) => {
        input.capsule.assertOriginalUnchanged.mockRejectedValue(new Error("lease revoked"));
      },
    ]) {
      const input = await fixture();
      mutate(input);
      await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toThrow();
    }
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("permits catalog-only rebase but rejects authored projection, fixture binding and viewport drift", async () => {
    const cases: Array<(input: Awaited<ReturnType<typeof fixture>>) => Promise<void> | void> = [
      (input) => {
        input.drafts.directions[0].layout.density = "spacious";
      },
      async (input) => {
        input.drafts.comparisonInputs.sampleContent[0].label = "Changed";
        await refreshDraft(input.drafts);
      },
      (input) => {
        const command = input.blueprint.commands.find(
          (command) => command.template === "preview-render",
        )!;
        command.routes[0].fixtureIds = [];
      },
      (input) => {
        const command = input.blueprint.commands.find(
          (command) => command.template === "preview-render",
        )!;
        command.viewports.desktop.width = 300;
      },
      (input) => {
        input.blueprint.theme.tokens = { colors: { primary: "#123456" } };
      },
    ];
    for (const mutate of cases) {
      const input = await fixture();
      await mutate(input);
      await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toThrow();
    }
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("requires the observed default locale, and never substitutes the first environment locale", async () => {
    const input = await fixture();
    input.defaultLocale = null;
    await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    input.defaultLocale = "ja";
    await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toMatchObject({
      reason: "input",
    });
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("rejects malformed observation transport, non-200 document responses and wrong inner/outer route bindings", async () => {
    const changes = [
      (capture: Record<string, unknown>) => {
        capture.extra = true;
      },
      (capture: Record<string, unknown>) => {
        capture.status = 204;
      },
      (capture: Record<string, unknown>) => {
        capture.pageId = "member";
      },
      (capture: Record<string, unknown>) => {
        capture.locale = "en";
      },
      (capture: Record<string, unknown>) => {
        (capture.document as Record<string, unknown>).route = "/member";
      },
      (capture: Record<string, unknown>) => {
        (capture.interaction as Record<string, unknown>).themePackage = "@nexpress/theme-docs";
      },
      (capture: Record<string, unknown>) => {
        (capture.document as Record<string, unknown>).phase = "interaction";
      },
    ];
    for (const change of changes) {
      sandbox.mockImplementation((input) => {
        const result = response(input);
        const capture = JSON.parse(
          new TextDecoder().decode(result.artifacts.get("preview-checks-000.json")),
        );
        change(capture);
        result.artifacts.set("preview-checks-000.json", encode(capture));
        return Promise.resolve(result);
      });
      await expect(renderPreparedSiteBuildFinalPreviewV1(await fixture())).rejects.toMatchObject({
        reason: "input",
      });
    }
  });
  it("rejects a well-formed PNG at the wrong physical dimensions and checks a revoked lease after capture", async () => {
    sandbox.mockImplementation((input) => {
      const result = response(input);
      result.artifacts.set("page-000.png", png(241, 240));
      return Promise.resolve(result);
    });
    await expect(renderPreparedSiteBuildFinalPreviewV1(await fixture())).rejects.toMatchObject({
      reason: "input",
    });
    const input = await fixture();
    sandbox.mockImplementation((call) => {
      input.capsule.assertOriginalUnchanged.mockRejectedValue(new Error("changed after capture"));
      return Promise.resolve(response(call));
    });
    await expect(renderPreparedSiteBuildFinalPreviewV1(input)).rejects.toThrow(
      "changed after capture",
    );
  });
  it("checks live image and request bindings again after the progress callback", async () => {
    const input = await fixture();
    await expect(
      renderPreparedSiteBuildFinalPreviewV1({
        ...input,
        progress: () => {
          input.image.baseImageId = `sha256:${"a".repeat(64)}`;
        },
      }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(sandbox).not.toHaveBeenCalled();
  });
});
