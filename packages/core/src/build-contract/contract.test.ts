import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import collectionVectors from "./__fixtures__/collection-v1.json" with { type: "json" };
import executionVectors from "./__fixtures__/execution-v1.json" with { type: "json" };
import rendererVectors from "./__fixtures__/renderer-v1.json" with { type: "json" };
import vectors from "./__fixtures__/canonical-v1.json" with { type: "json" };
import directionVectors from "./__fixtures__/direction-v1.json" with { type: "json" };
import {
  npAnalyzeAgentSiteBriefV1,
  npAnalyzeAgentSiteBlueprintV1,
  npBuildCanonicalBodyValidatorsV1,
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildCanonicalPurposes,
  npBuildFileDigest,
  npBuildFilePurposes,
  npParseAgentSiteBriefV1,
  npParseBuildJsonV1,
  npParseBuildCandidateTransportJsonV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireAgentBuildSourceTreeV1,
  npRequireAgentGeneratedMediaPromptV1,
  npRequireAgentSiteBlueprintV1,
  npRequireAgentBuildSeedPlanV1,
  npRequireAgentBuildNavigationV1,
  npRequireAgentSiteBriefV1,
  npRequireBuildReadyBriefV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildVerificationForBlueprintV1,
  npRequireAgentBuildVerificationResultBodyV1,
  npIsBuildSourcePathExcludedV1,
  type NpBuildImplementedCanonicalPurposeV1,
  type NpBuildFilePurposeV1,
  type NpAgentSiteBlueprintV1,
  type NpAgentBlueprintCommand,
} from "./index.js";
import { inspectJson, serializeJson } from "./primitives.js";

const brief = () => JSON.parse(vectors.structured[0].canonical) as unknown;
const blueprint = () =>
  npRequireAgentSiteBlueprintV1(JSON.parse(vectors.structured[1].canonical) as unknown);
const tree = () =>
  npRequireAgentBuildSourceTreeV1(JSON.parse(vectors.structured[4].canonical) as unknown);
const digest = `nb1:sha256:${"A".repeat(43)}`;
const fileDigest = `nb1:file-sha256:${"A".repeat(43)}`;
function changed(mutator: (p: NpAgentSiteBlueprintV1) => void): NpAgentSiteBlueprintV1 {
  const p = blueprint();
  mutator(p);
  return p;
}
function preview(p: NpAgentSiteBlueprintV1, count = 1): void {
  p.pages = Array.from({ length: count }, (_, i) => ({
    id: `page-${i}`,
    route: `/page-${i}`,
    locale: null,
    audience: "public",
    source: "custom",
    patternId: null,
    patternOverrides: null,
    templateId: "page",
    blocks: [],
  }));
  const command: NpAgentBlueprintCommand = {
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 3600,
    template: "preview-render",
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: p.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      fixtureIds: ["sample-home"],
    })),
    viewports: {
      desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
      mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
    },
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: p.pages.flatMap((page) =>
      (["desktop", "mobile"] as const).map((viewport) => ({
        kind: "screenshot" as const,
        pageId: page.id,
        viewport,
        path: `.nexpress/site/review/final/${page.id}-${viewport}.png`,
      })),
    ),
    verificationResultPath: ".nexpress/site/review/final/result.json",
  };
  command.artifacts.push({ kind: "report", path: ".nexpress/site/review/final/report.json" });
  p.commands.push(command);
  p.verification.push(
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
      artifactPath: command.verificationResultPath,
    },
  );
}

describe("Build canonical profile v1", () => {
  it("binds observed verification inventory to every exact blueprint command and preview declaration", async () => {
    const proposal = blueprint();
    preview(proposal);
    const body = npRequireAgentBuildVerificationResultBodyV1({
      ...JSON.parse(executionVectors.structured[2].canonical),
      blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", proposal),
      commandResults: proposal.commands.map((command) => ({ commandId: command.id, exitCode: 0 })),
      artifacts: JSON.parse(executionVectors.structured[2].canonical).artifacts.map(
        (artifact: { path: string; pageId: string | null }) => ({
          ...artifact,
          path: artifact.path.replace("home-", "page-0-"),
          pageId: artifact.pageId === null ? null : "page-0",
        }),
      ),
    });
    const result = {
      ...body,
      manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", body),
    };
    expect(await npRequireBuildVerificationForBlueprintV1(proposal, result)).toEqual(result);
    const reversed = { ...body, commandResults: [...body.commandResults].reverse() };
    await expect(
      npRequireBuildVerificationForBlueprintV1(proposal, {
        ...reversed,
        manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", reversed),
      }),
    ).rejects.toThrow();
    await expect(
      npRequireBuildVerificationForBlueprintV1(proposal, {
        ...result,
        finalSourceDigest: fileDigest,
      }),
    ).rejects.toThrow();
    const changed = {
      ...body,
      artifacts: body.artifacts.map((artifact) =>
        artifact.kind === "screenshot" ? { ...artifact, pageId: "another-page" } : artifact,
      ),
    };
    await expect(
      npRequireBuildVerificationForBlueprintV1(proposal, {
        ...changed,
        manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", changed),
      }),
    ).rejects.toThrow();
  });
  it("locks all sixteen purpose/body/vector inventories and rejects unknown owners", async () => {
    expect(npBuildCanonicalPurposes).toHaveLength(16);
    expect(npBuildFilePurposes).toHaveLength(4);
    expect(Object.keys(npBuildCanonicalBodyValidatorsV1)).toEqual([...npBuildCanonicalPurposes]);
    expect(
      Object.entries(npBuildCanonicalBodyValidatorsV1)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .sort(),
    ).toEqual(
      [
        ...new Set(
          [
            ...vectors.structured,
            ...directionVectors.structured,
            ...collectionVectors.structured,
            ...executionVectors.structured,
            ...rendererVectors.structured,
          ].map((v) => v.purpose),
        ),
      ].sort(),
    );
    await expect(
      Reflect.apply(npBuildCanonicalDigest, undefined, ["__proto__", {}]),
    ).rejects.toThrow("unknown canonical purpose");
  });
  it("matches independent Python canonical bytes/digests and Node SHA-256", async () => {
    for (const vector of [
      ...vectors.structured,
      ...directionVectors.structured,
      ...collectionVectors.structured,
      ...executionVectors.structured,
    ]) {
      const purpose = vector.purpose as NpBuildImplementedCanonicalPurposeV1;
      const bytes = npBuildCanonicalBytes(purpose, JSON.parse(vector.canonical) as unknown);
      expect(new TextDecoder().decode(bytes.canonicalJsonUtf8), purpose).toBe(vector.canonical);
      expect(
        await npBuildCanonicalDigest(purpose, JSON.parse(vector.canonical) as unknown),
        purpose,
      ).toBe(vector.digest);
      expect(
        `nb1:sha256:${createHash("sha256").update(bytes.domainSeparatedUtf8).digest("base64url")}`,
      ).toBe(vector.digest);
      expect(
        new TextDecoder()
          .decode(bytes.domainSeparatedUtf8)
          .startsWith(`np.build-canonical-json.v1\0${purpose}\0`),
      ).toBe(true);
    }
  });
  it("locks empty/binary/CRLF raw files for all four purposes with u64 byte lengths", async () => {
    expect([...new Set(vectors.files.map((v) => v.purpose))]).toEqual([...npBuildFilePurposes]);
    for (const v of vectors.files)
      expect(
        await npBuildFileDigest(
          v.purpose as NpBuildFilePurposeV1,
          Buffer.from(v.base64url, "base64url"),
        ),
      ).toBe(v.digest);
    await expect(
      Reflect.apply(npBuildFileDigest, undefined, ["np.build-site-brief.v1", new Uint8Array()]),
    ).rejects.toThrow();
  });
  it("uses JCS UTF-16 key order without normalization and preserves array order", async () => {
    const value = {
      דּ: "hebrew",
      "😀": "emoji",
      "€": "euro",
      "1": -0,
      "\r": "line",
      n: [4.5, 0.002, 1e-27],
    };
    expect(serializeJson(inspectJson(value, 1024, 4))).toBe(
      '{"\\r":"line","1":0,"n":[4.5,0.002,1e-27],"€":"euro","😀":"emoji","דּ":"hebrew"}',
    );
    const a = npRequireAgentSiteBriefV1(brief()),
      b = npRequireAgentSiteBriefV1(brief());
    a.project.name = "é";
    b.project.name = "e\u0301";
    expect(await npBuildCanonicalDigest("np.build-site-brief.v1", a)).not.toBe(
      await npBuildCanonicalDigest("np.build-site-brief.v1", b),
    );
    const reversed = Object.fromEntries(Object.entries(a).reverse());
    expect(await npBuildCanonicalDigest("np.build-site-brief.v1", reversed)).toBe(
      await npBuildCanonicalDigest("np.build-site-brief.v1", a),
    );
  });
  it("rejects duplicate raw keys, malformed JSON, unsafe numbers and excessive raw nesting", () => {
    for (const raw of [
      '{"x":1,"x":2}',
      '{"x":1,"\\u0078":2}',
      '{"nested":{"k":1,"k":2}}',
      "[1,]",
      '{"x":}',
      "01",
      "{} trailing",
      "\ufeff{}",
      '{"x":"\\ud800"}',
      '{"x":9007199254740992}',
      '{"x":1e999}',
      `${"[".repeat(18)}0${"]".repeat(18)}`,
    ])
      expect(() => npParseBuildJsonV1(raw), raw).toThrow();
    const raw = '{"__proto__":{"safe":true},"text":"brace }"}';
    expect(npParseBuildJsonV1(raw)).toEqual(JSON.parse(raw));
    expect(npParseBuildJsonV1(JSON.stringify({ text: 'quoted " } ]' }))).toEqual({
      text: 'quoted " } ]',
    });
    expect(npParseAgentSiteBriefV1(JSON.stringify(brief()))).toEqual(brief());
  });
  it("parses candidate envelopes without weakening ordinary JSON or raw-input bounds", () => {
    const wrapped = (body: string, depth: number) =>
      `${"[".repeat(depth)}${body}${"]".repeat(depth)}`;
    const deep = wrapped('{"candidate":"valid transport only"}', 22);
    expect(() => npParseBuildJsonV1(deep)).toThrow();
    expect(npParseBuildCandidateTransportJsonV1(deep)).toEqual(JSON.parse(deep));
    for (const raw of [
      wrapped("0", 25),
      wrapped('{"field":1,"\\u0066ield":2}', 22),
      wrapped('{"number":9007199254740992}', 22),
      wrapped('{"text":"\\ud800"}', 22),
      " ".repeat(8 * 1024 * 1024 + 1),
    ])
      expect(() => npParseBuildCandidateTransportJsonV1(raw)).toThrow();
  });
  it("rejects hostile containers without executing accessors or toJSON", () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, "x", {
      get() {
        calls++;
        throw Error("must not run");
      },
      enumerable: true,
    });
    const shared = { x: 1 };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = Array(2);
    const hidden = Object.defineProperty({}, "x", { value: 1 });
    for (const v of [
      accessor,
      {
        toJSON() {
          calls++;
        },
      },
      Object.create(null) as unknown,
      new Date(),
      { a: shared, b: shared },
      cycle,
      sparse,
      hidden,
      { [Symbol("x")]: 1 },
      { x: Infinity },
      { x: NaN },
      { x: undefined },
      { x: 1n },
      { x: "\udc00" },
    ])
      expect(() => inspectJson(v, 1024, 8)).toThrow();
    expect(calls).toBe(0);
  });
});

describe("Site Brief proposal contract", () => {
  it("owns detached, exact bounded data and a conservative readiness boundary", () => {
    const input = npRequireAgentSiteBriefV1(brief());
    const parsed = npRequireAgentSiteBriefV1(input);
    input.project.name = "changed";
    expect(parsed.project.name).toBe("Demo");
    input.unresolved = ["Decide member authoring"];
    expect(npAnalyzeAgentSiteBriefV1(input).ok).toBe(true);
    expect(() => npRequireBuildReadyBriefV1(input)).toThrow("outstanding");
    expect(npRequireBuildReadyBriefV1(parsed)).toEqual(parsed);
  });
  it("rejects unknown fields, invalid citations/locales, unsafe counts and field/count limits", () => {
    const probes = [
      { ...npRequireAgentSiteBriefV1(brief()), apiKey: "forbidden" },
      { ...npRequireAgentSiteBriefV1(brief()), locales: ["en-us"] },
    ];
    for (const url of [
      "http://example.com/",
      "https://u:p@example.com/",
      "https://EXAMPLE.com/",
      "https://example.com",
    ]) {
      const v = npRequireAgentSiteBriefV1(brief());
      v.design.references[0].url = url;
      probes.push(v);
    }
    const tooMany = npRequireAgentSiteBriefV1(brief());
    tooMany.features = Array.from({ length: 101 }, (_, i) => `feature ${i}`);
    probes.push(tooMany);
    const oversized = npRequireAgentSiteBriefV1(brief());
    oversized.project.summary = "x".repeat(2001);
    probes.push(oversized);
    const unsafe = npRequireAgentSiteBriefV1(brief());
    unsafe.operations.expectedMembers = Number.MAX_SAFE_INTEGER + 1;
    probes.push(unsafe);
    for (const value of probes) expect(npAnalyzeAgentSiteBriefV1(value).ok).toBe(false);
  });
});

describe("Site Blueprint proposal contract", () => {
  it("binds a blueprint to the supplied resolved brief, locale inventory and generated prompt", async () => {
    const b = npRequireBuildReadyBriefV1(brief()),
      p = blueprint();
    await expect(npRequireBuildBlueprintForBriefV1(b, p)).rejects.toThrow("exact confirmed brief");
    p.briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", b);
    expect(await npRequireBuildBlueprintForBriefV1(b, p)).toEqual(p);
    p.pages[0].locale = "fr";
    await expect(npRequireBuildBlueprintForBriefV1(b, p)).rejects.toThrow("locale inventory");
    p.pages[0].locale = null;
    const generationPrompt = npRequireAgentGeneratedMediaPromptV1(
      JSON.parse(vectors.structured[2].canonical) as unknown,
    );
    p.seed.mode = "demo-fixtures";
    p.seed.media.push({
      mediaId: "11111111-1111-4111-8111-111111111111",
      kind: "generated",
      materialization: "staged",
      stagedArtifactPath: ".nexpress/site/media/demo.png",
      contentHash: fileDigest,
      mimeType: "image/png",
      byteSize: 1,
      generatorId: "external-generator",
      generationPrompt,
      promptDigest: digest,
      rightsNote: "Synthetic image",
      provenanceNote: "Demo fixture",
      alt: "Blue shape",
    });
    await expect(npRequireBuildBlueprintForBriefV1(b, p)).rejects.toThrow("prompt envelope");
    const generated = p.seed.media[0];
    if (generated.kind !== "generated") throw new Error("expected generated fixture");
    generated.promptDigest = await npBuildCanonicalDigest(
      "np.build-generated-media-prompt.v1",
      generationPrompt,
    );
    expect(await npRequireBuildBlueprintForBriefV1(b, p)).toEqual(p);
  });
  it("accepts a complete 200-route preview with one manifest check", () => {
    const p = blueprint();
    preview(p, 200);
    expect(npRequireAgentSiteBlueprintV1(p).commands).toHaveLength(2);
    expect(p.verification).toHaveLength(4);
  });
  it("rejects unknown fields and incorrect page/file/media/check discriminants", () => {
    const cases = [
      changed((p) => Object.assign(p, { blueprintHash: digest })),
      changed((p) => Object.assign(p.pages[0], { patternId: "pattern" })),
      changed((p) => Object.assign(p.filePlan[0], { expectedHash: fileDigest })),
      changed((p) =>
        Object.assign(p.verification[0], { artifactPath: ".nexpress/site/review/forged.png" }),
      ),
      changed((p) => Object.assign(p.commands[0], { argv: ["sh", "-c", "echo unsafe"] })),
      changed((p) => (p.filePlan[0].stagedArtifactPath = ".nexpress/site/files/.env.local")),
      changed((p) => {
        p.seed.mode = "none";
        p.seed.media.push({
          mediaId: "11111111-1111-4111-8111-111111111111",
          kind: "placeholder",
          materialization: "reference-only",
          placeholderId: "empty",
          provenanceNote: "Synthetic placeholder",
          alt: "Placeholder",
        });
      }),
    ];
    for (const p of cases) expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(false);
  });
  it("rejects traversal, secrets, ignored outputs, aliases and file/directory collisions", () => {
    for (const path of [
      "/tmp/a",
      "../a",
      "src/../a",
      "C:/a",
      "src\\a",
      ".git/config",
      ".GIT/config",
      "NODE_MODULES/a",
      "node_modules/a",
      "src/.env.local",
      ".npmrc",
      ".nexpress/site/review/a",
      "src/id_rsa",
      "src/key.pem",
      "src/a%2fb",
      "src/CON.ts",
    ]) {
      const p = changed((p) => {
        p.filePlan[0].path = path;
        const command = p.commands[0];
        if (command.template === "format") command.files = [path];
      });
      expect(npAnalyzeAgentSiteBlueprintV1(p).ok, path).toBe(false);
    }
    for (const [a, b] of [
      ["src/Foo.ts", "src/foo.ts"],
      ["src/straße.ts", "src/STRASSE.ts"],
      ["src/é.ts", "src/e\u0301.ts"],
      ["src/Foo", "src/foo/bar.ts"],
    ]) {
      const p = changed((p) => {
        p.filePlan[0].path = a;
        p.filePlan.push({ ...p.filePlan[0], path: b });
        const command = p.commands[0];
        if (command.template === "format") command.files = [a, b];
      });
      expect(npAnalyzeAgentSiteBlueprintV1(p).ok, `${a} ${b}`).toBe(false);
    }
  });
  it("rejects missing/cyclic/unordered command graphs and missing required checks", () => {
    for (const prerequisites of [["missing"], ["format"]])
      expect(
        npAnalyzeAgentSiteBlueprintV1(changed((p) => (p.commands[0].prerequisites = prerequisites)))
          .ok,
      ).toBe(false);
    expect(npAnalyzeAgentSiteBlueprintV1(changed((p) => (p.verification = []))).ok).toBe(false);
    expect(
      npAnalyzeAgentSiteBlueprintV1(changed((p) => (p.verification[1].required = false))).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentSiteBlueprintV1(changed((p) => (p.verification[0].commandId = "missing"))).ok,
    ).toBe(false);
    const p = blueprint();
    preview(p);
    p.commands[0].prerequisites = ["preview"];
    expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(false);
    const q = blueprint();
    preview(q);
    q.commands.reverse();
    expect(npAnalyzeAgentSiteBlueprintV1(q).ok).toBe(false);
  });
  it("binds generated-file owners, typed arguments and preview routes/artifacts/checks", () => {
    const probes = [
      changed((p) =>
        Object.assign(p.filePlan[0], {
          source: "command",
          stagedArtifactPath: null,
          generatedByCommandId: "format",
        }),
      ),
      changed((p) => {
        p.commands.push({
          id: "type",
          cwd: "project",
          template: "typecheck",
          workspaceFilter: "foo; curl example.com",
          prerequisites: ["format"],
          timeoutSeconds: 60,
        });
        p.verification.push({
          id: "type-exit",
          commandId: "type",
          required: true,
          expected: "exit-zero",
          artifactPath: null,
        });
      }),
    ];
    for (const mutate of [
      (c: Extract<NpAgentBlueprintCommand, { template: "preview-render" }>) => {
        c.artifacts.pop();
      },
      (c: Extract<NpAgentBlueprintCommand, { template: "preview-render" }>) => {
        c.artifacts[1].path = c.artifacts[0].path;
      },
      (c: Extract<NpAgentBlueprintCommand, { template: "preview-render" }>) => {
        c.routes[0].audience = "member";
      },
      (c: Extract<NpAgentBlueprintCommand, { template: "preview-render" }>) => {
        c.verificationResultPath = c.artifacts[0].path;
      },
    ]) {
      const p = blueprint();
      preview(p);
      const command = p.commands[1];
      if (command.template === "preview-render") mutate(command);
      probes.push(p);
    }
    for (const p of probes) expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(false);
  });
  it("enforces seed graph resolution and placeholder-only environment requirements", () => {
    const p = blueprint();
    p.seed.mode = "demo-fixtures";
    p.seed.documents = [
      {
        documentId: "11111111-1111-4111-8111-111111111111",
        collection: "articles",
        locale: null,
        translationGroupId: null,
        dependsOnDocumentIds: [],
        data: { title: "Synthetic demo" },
        provenance: "demo",
      },
    ];
    expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(true);
    expect(npRequireAgentBuildSeedPlanV1(p.seed)).toEqual(p.seed);
    p.seed.documents[0].data = { relation: { $ref: "client:demo" } };
    expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(false);
    expect(() => npRequireAgentBuildSeedPlanV1(p.seed)).toThrow();
    p.seed.documents[0].data = { title: "Synthetic demo" };
    p.seed.documents[0].dependsOnDocumentIds = [p.seed.documents[0].documentId];
    expect(npAnalyzeAgentSiteBlueprintV1(p).ok).toBe(false);
    expect(() => npRequireAgentBuildSeedPlanV1(p.seed)).toThrow();
    expect(() =>
      npRequireAgentBuildSeedPlanV1({ ...p.seed, mode: "none", documents: [] }),
    ).not.toThrow();
    expect(() => npRequireAgentBuildSeedPlanV1({ ...p.seed, mode: "none" })).toThrow();
    expect(() =>
      npRequireAgentBuildNavigationV1({ location: "header", items: [], injected: true }),
    ).toThrow();
    expect(npRequireAgentBuildNavigationV1({ location: "header", items: [] })).toEqual({
      location: "header",
      items: [],
    });
    for (const env of [
      { name: "SECRET", owner: "nexpress", sourceId: null },
      { name: "NP_SECRET=value", owner: "nexpress", sourceId: null },
      { name: "PLUGIN_KEY", owner: "plugin", sourceId: null },
    ])
      expect(
        npAnalyzeAgentSiteBlueprintV1(
          changed((p) => Object.assign(p.deployment, { requiredEnvironment: [env] })),
        ).ok,
      ).toBe(false);
  });
});

describe("auxiliary Build bytes", () => {
  it("validates maximum source and seed inventories without pairwise graph/path scans", () => {
    const files = Array.from({ length: 10_000 }, (_, i) => ({
      path: `src/${i.toString().padStart(5, "0")}.ts`,
      kind: "file" as const,
      mode: "100644" as const,
      digest: fileDigest,
    }));
    expect(
      npRequireAgentBuildSourceTreeV1({ schemaVersion: "np.agent-build-source-tree.v1", files })
        .files,
    ).toHaveLength(10_000);
    const p = blueprint();
    p.seed.mode = "demo-fixtures";
    p.seed.documents = Array.from({ length: 1000 }, (_, i) => ({
      documentId: `11111111-1111-4111-8111-${i.toString().padStart(12, "0")}`,
      collection: "articles",
      locale: null,
      translationGroupId: null,
      dependsOnDocumentIds: [],
      data: { title: `Synthetic demo ${i}` },
      provenance: "demo",
    }));
    expect(npRequireAgentSiteBlueprintV1(p).seed.documents).toHaveLength(1000);
  });
  it("binds source-tree ordering, executable bits, exclusions and regular-file discriminants", async () => {
    const baseline = await npBuildCanonicalDigest("np.build-source-tree.v1", tree());
    const mode = tree();
    mode.files[0].mode = "100755";
    expect(await npBuildCanonicalDigest("np.build-source-tree.v1", mode)).not.toBe(baseline);
    for (const mutate of [
      (t: ReturnType<typeof tree>) => {
        t.files.reverse();
      },
      (t: ReturnType<typeof tree>) => {
        Object.assign(t.files[0], { kind: "symlink" });
      },
      (t: ReturnType<typeof tree>) => {
        t.files[0].path = ".git/config";
      },
      (t: ReturnType<typeof tree>) => {
        t.files.push({ ...t.files[0], path: "A.TXT" });
      },
    ]) {
      const t = tree();
      mutate(t);
      expect(() => npRequireAgentBuildSourceTreeV1(t)).toThrow();
    }
    for (const path of [
      ".git/config",
      ".nexpress/site/review/a.png",
      ".nexpress/site/tmp/a",
      ".nexpress/site/audit/a",
      "src/node_modules/a",
      "dist/a",
      "a/.next/x",
      ".turbo/a",
      "coverage/a",
    ])
      expect(npIsBuildSourcePathExcludedV1(path), path).toBe(true);
    expect(npIsBuildSourcePathExcludedV1("src/distribution.ts")).toBe(false);
  });
  it("preserves raw output including truncation and requires canonical base64url", async () => {
    const v = npRequireAgentBuildCommandOutputV1(
      JSON.parse(vectors.structured[3].canonical) as unknown,
    );
    const before = await npBuildCanonicalDigest("np.build-command-output.v1", v);
    v.stdout.truncated = true;
    expect(await npBuildCanonicalDigest("np.build-command-output.v1", v)).not.toBe(before);
    for (const base64url of [
      "A",
      "AB",
      "AA=",
      "AA/",
      Buffer.alloc(256 * 1024 + 1).toString("base64url"),
    ])
      expect(() =>
        npRequireAgentBuildCommandOutputV1({ ...v, stdout: { base64url, truncated: false } }),
      ).toThrow();
    expect(() =>
      npRequireAgentBuildCommandOutputV1({
        ...v,
        stdout: { base64url: Buffer.alloc(256 * 1024).toString("base64url"), truncated: false },
      }),
    ).not.toThrow();
  });
  it("bounds redacted media prompts and exact-text branches", () => {
    const v = npRequireAgentGeneratedMediaPromptV1(
      JSON.parse(vectors.structured[2].canonical) as unknown,
    );
    expect(() =>
      npRequireAgentGeneratedMediaPromptV1({
        ...v,
        prompt: "한".repeat(4000),
        avoid: Array.from({ length: 20 }, (_, i) => `${i}-${"한".repeat(190)}`),
        textPolicy: {
          kind: "exact",
          exactText: Array.from({ length: 20 }, (_, i) => `${i}-${"한".repeat(190)}`),
        },
      }),
    ).not.toThrow();
    expect(() =>
      npRequireAgentGeneratedMediaPromptV1({ ...v, prompt: "x".repeat(4001) }),
    ).toThrow();
    expect(() =>
      npRequireAgentGeneratedMediaPromptV1({
        ...v,
        textPolicy: { kind: "none", exactText: ["hidden"] },
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGeneratedMediaPromptV1({ ...v, referenceArtifactIds: ["b", "a"] }),
    ).toThrow();
  });
});
