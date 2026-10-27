import { describe, expect, it } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npRequireAgentBuildVerificationResultBodyV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentSiteBlueprintV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  type NpAgentBuildVerificationResultV1,
  type NpAgentBuildVerificationObservationV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVectors from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import execution from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import { createSiteBuildHandoffV1, type NpSiteBuildHandoffInputV1 } from "./build-handoff.js";

const digest = `nb1:sha256:${"A".repeat(43)}`;
const resultPath = ".nexpress/site/review/final/result.json";
async function fixture(target: "local" | "vercel" = "local") {
  const brief = npRequireBuildReadyBriefV1(structuredClone(directionVectors.brief));
  brief.operations.target = target;
  const briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
  const directions = npRequireAgentDesignDirectionSetV1(structuredClone(directionVectors.set));
  directions.briefHash = briefHash;
  directions.comparisonInputs.briefHash = briefHash;
  directions.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    directions.comparisonInputs,
  );
  for (const direction of directions.directions) {
    direction.comparisonInputsDigest = directions.comparisonInputsDigest;
    const { previewArtifact: _preview, projectionDigest: _digest, ...projection } = direction;
    const projected = npBuildDirectionProjectionV1({
      ...projection,
      schemaVersion: "np.agent-design-direction-draft.v1",
    });
    direction.projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      projected,
    );
    for (const image of [direction.previewArtifact.desktop, direction.previewArtifact.mobile]) {
      image.comparisonInputsDigest = directions.comparisonInputsDigest;
      image.directionProjectionDigest = direction.projectionDigest;
    }
  }
  await npRequireBuildDirectionSetForBriefV1(brief, directions, "sealed");
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!
        .canonical,
    ),
  );
  const selected = directions.directions[0];
  blueprint.briefHash = briefHash;
  blueprint.deployment.target = target;
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    directions,
  );
  blueprint.selectedDirectionId = selected.id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    selected,
  );
  blueprint.selectedDirectionProjectionDigest = selected.projectionDigest;
  blueprint.discoveryFingerprint = directions.discoveryFingerprint;
  blueprint.deployment.requiredEnvironment = [
    { name: "DATABASE_URL", owner: "platform", sourceId: null },
    { name: "NP_SECRET", owner: "nexpress", sourceId: null },
  ];
  blueprint.deployment.notes = ["fixture-sensitive-password=value https://private.invalid"];
  blueprint.filePlan[0].rationale = "fixture-sensitive-password=value";
  const artifactBody = npRequireAgentBuildVerificationResultBodyV1(
    JSON.parse(
      execution.structured.find((entry) => entry.purpose === "np.build-verification-result.v1")!
        .canonical,
    ),
  );
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 60,
    template: "preview-render",
    comparisonInputsDigest: directions.comparisonInputsDigest,
    renderEnvironmentFingerprint: digest,
    routes: blueprint.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      fixtureIds: [],
    })),
    viewports: directions.comparisonInputs.viewports,
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: artifactBody.artifacts.map((artifact) =>
      artifact.kind === "screenshot"
        ? {
            kind: "screenshot",
            path: artifact.path,
            pageId: artifact.pageId,
            viewport: artifact.viewport,
          }
        : { kind: "report", path: artifact.path },
    ),
    verificationResultPath: resultPath,
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
      artifactPath: resultPath,
    },
  );
  const sourceTree = {
    schemaVersion: "np.agent-build-source-tree.v1",
    files: blueprint.filePlan.map((file) => ({
      path: file.path,
      kind: "file",
      mode: "100644",
      digest: file.contentHash,
    })),
  };
  const input: NpSiteBuildHandoffInputV1 = {
    brief,
    directions,
    blueprint,
    artifactPaths: {
      brief: ".nexpress/site/brief.json",
      directions: ".nexpress/site/directions.json",
      blueprint: ".nexpress/site/blueprint.json",
      verification: resultPath,
    },
    verification: null,
    sourceTree,
  };
  const body = {
    ...artifactBody,
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    renderEnvironmentFingerprint: digest,
    finalSourceDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", sourceTree),
    commandResults: blueprint.commands.map((command) => ({ commandId: command.id, exitCode: 0 })),
  };
  const result: NpAgentBuildVerificationResultV1 = {
    ...body,
    manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", body),
  };
  const observation: NpAgentBuildVerificationObservationV1 = {
    schemaVersion: "np.agent-build-verification-observation.v1",
    manifestDigest: result.manifestDigest,
    commandResults: result.commandResults.map((command) => ({
      ...command,
      outputDigest: digest,
      durationMs: 10,
      outputArtifactPath: `.nexpress/site/audit/run-1/${command.commandId}.json`,
    })),
    startedAt: "2026-10-23T00:00:00.000Z",
    finishedAt: "2026-10-23T00:00:01.000Z",
  };
  input.verification = { result, observations: [observation] };
  return { input, brief, directions, blueprint, sourceTree, result, observation };
}
async function rebindResult(value: Awaited<ReturnType<typeof fixture>>) {
  const { manifestDigest: _manifest, ...body } = value.result;
  body.blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", value.blueprint);
  value.result.blueprintHash = body.blueprintHash;
  value.result.manifestDigest = await npBuildCanonicalDigest(
    "np.build-verification-result.v1",
    body,
  );
  value.observation.manifestDigest = value.result.manifestDigest;
}

describe("local Build product handoff", () => {
  it("returns usable DTO and Markdown with artifact identities, ownership and recorded checks", async () => {
    const { input, blueprint, result } = await fixture();
    const { handoff, markdown } = await createSiteBuildHandoffV1(input);
    expect(handoff.status).toBe("review-required");
    expect(handoff.executable).toBe(false);
    expect(handoff.bindings.blueprintHash).toBe(result.blueprintHash);
    expect(handoff.artifacts).toHaveLength(15);
    expect(handoff.files[0]).toMatchObject({
      path: blueprint.filePlan[0].path,
      owner: "page",
      state: "observed-match",
      contentHash: blueprint.filePlan[0].contentHash,
    });
    expect(handoff.requiredEnvironmentNames).toEqual(["DATABASE_URL", "NP_SECRET"]);
    expect(handoff.verification.state).toBe("recorded-pass");
    expect(handoff.verification.checks.find((check) => check.expected === "no-diff")?.state).toBe(
      "unverified",
    );
    expect(
      handoff.verification.checks.find((check) => check.expected === "review-artifact")?.state,
    ).toBe("open");
    expect(handoff.publication).toEqual({
      git: "unverified",
      pullRequest: "unverified",
      deployment: "unverified",
      previewUrls: [],
    });
    expect(markdown).toContain("# Local Build handoff");
    expect(markdown).toContain("git status --short");
    expect(markdown).toContain(blueprint.filePlan[0].contentHash);
    expect(JSON.stringify(handoff) + markdown).not.toMatch(/fixture-sensitive|private\.invalid/u);
    expect(Object.values(handoff.authority).every((value) => value === false)).toBe(true);
    expect(
      handoff.nextCommands.every(
        (command) =>
          command.execution === "not-run" && command.authorization === "separate-user-instruction",
      ),
    ).toBe(true);
    expect(handoff.nextCommands.some((command) => command.argv.includes("db:migrate"))).toBe(false);
  });

  it("lists ordinary project checks instead of a monorepo-only verify script", async () => {
    const { input } = await fixture();
    const { handoff, markdown } = await createSiteBuildHandoffV1(input);
    expect(
      handoff.nextCommands.filter((entry) => entry.purpose === "verify").map((entry) => entry.argv),
    ).toEqual([
      ["pnpm", "exec", "prettier", "--check", "--", "src/home.ts"],
      ["pnpm", "run", "typecheck"],
      ["pnpm", "exec", "eslint", ".", "--no-cache"],
      ["pnpm", "exec", "vitest", "run"],
      ["pnpm", "run", "build"],
      ["pnpm", "run", "doctor"],
    ]);
    expect(handoff.nextCommands.some((entry) => entry.argv.includes("verify"))).toBe(false);
    expect(handoff.nextCommands.some((entry) => entry.argv.includes("seed:content"))).toBe(false);
    expect(markdown).toContain("pnpm run doctor");
    expect(markdown).toContain("existing site and Admin account");
    expect(markdown).toContain("does not apply migrations, create an Admin, or start a server");
    expect(markdown).not.toContain("pnpm verify");
  });

  it("resumes a bound ordinary seed and local Admin only as explicit manual steps", async () => {
    const data = await fixture();
    for (const path of ["site-build.seed.json", "scripts/seed-content.ts"]) {
      data.blueprint.filePlan.push({
        ...data.blueprint.filePlan[0],
        path,
        owner: "seed",
        source: "staged",
        stagedArtifactPath: `.nexpress/site/files/seed/${path.split("/").at(-1)!}`,
        generatedByCommandId: null,
      });
      data.sourceTree.files.push({
        path,
        kind: "file",
        mode: "100644",
        digest: data.blueprint.filePlan[0].contentHash,
      });
    }
    data.blueprint.filePlan.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
    data.sourceTree.files.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
    data.result.finalSourceDigest = await npBuildCanonicalDigest(
      "np.build-source-tree.v1",
      data.sourceTree,
    );
    await rebindResult(data);
    const { handoff, markdown } = await createSiteBuildHandoffV1(data.input);
    const seed = handoff.nextCommands.find((entry) => entry.argv.includes("seed:content"));
    const dev = handoff.nextCommands.find((entry) => entry.argv.includes("dev"));
    expect(seed).toEqual({
      purpose: "review",
      argv: ["pnpm", "run", "seed:content"],
      execution: "not-run",
      authorization: "separate-user-instruction",
    });
    expect(dev).toEqual({
      purpose: "review",
      argv: ["pnpm", "run", "dev"],
      execution: "not-run",
      authorization: "separate-user-instruction",
    });
    expect(markdown).toContain("local PostgreSQL database already has the reviewed migrations");
    expect(markdown).toContain("run `pnpm run seed:content` exclusively");
    expect(markdown).toContain("It writes content, theme and navigation through the normal owners");
    expect(markdown).toContain("pass `--site=<site-id>` as its one argument");
    expect(markdown).toContain("open `/admin` on that local server");
    expect(markdown).toContain("not read-only inspections or observed execution");
    expect(Object.values(handoff.authority).every((value) => value === false)).toBe(true);
    expect(handoff.executable).toBe(false);
    expect(
      handoff.nextCommands.some((entry) =>
        entry.argv.some((argument) => ["db:migrate", "db:push", "seed:admin"].includes(argument)),
      ),
    ).toBe(false);
  });

  it("supports an actual CLI dry-run result without inventing execution or source evidence", async () => {
    const { input } = await fixture();
    input.verification = null;
    delete input.artifactPaths.verification;
    delete input.sourceTree;
    const { handoff } = await createSiteBuildHandoffV1(input);
    expect(handoff.status).toBe("review-required");
    expect(handoff.verification.state).toBe("unverified");
    expect(handoff.verification.sourceSnapshot).toBe("unverified");
    expect(handoff.commandsNotObserved).toEqual(["format", "preview"]);
    expect(handoff.commands.every((command) => command.exitCode === null)).toBe(true);
    expect(handoff.files.every((file) => file.state === "planned")).toBe(true);
    expect(handoff.bindings.verificationManifestDigest).toBeNull();
    expect(handoff.artifacts.some((entry) => entry.role === "verification-result")).toBe(false);
  });

  it("does not treat a valid manifest without actual observations as an executed gate", async () => {
    const { input } = await fixture();
    input.verification!.observations = [];
    const { handoff } = await createSiteBuildHandoffV1(input);
    expect(handoff.verification.state).toBe("unverified");
    expect(handoff.commandsNotObserved).toHaveLength(2);
    expect(handoff.artifacts.find((entry) => entry.role === "verification-result")?.evidence).toBe(
      "artifact-binding",
    );
  });

  it("reports schema/migration generation separately from review and production application", async () => {
    const data = await fixture();
    const preview = data.blueprint.commands[1];
    preview.prerequisites = ["a-migration"];
    data.blueprint.commands.splice(
      1,
      0,
      {
        id: "a-schema",
        cwd: "project",
        prerequisites: ["format"],
        timeoutSeconds: 60,
        template: "schema-generate",
      },
      {
        id: "a-migration",
        cwd: "project",
        prerequisites: ["a-schema"],
        timeoutSeconds: 60,
        template: "migration-generate",
        name: "fixture",
      },
    );
    for (const [id, owner, filePath] of [
      ["a-schema", "generated-schema", "src/db/generated/collections.ts"],
      ["a-migration", "migration", "drizzle/0000_fixture.sql"],
    ] as const) {
      data.blueprint.filePlan.push({
        path: filePath,
        action: "create",
        owner,
        expectedHash: null,
        contentHash: data.blueprint.filePlan[0].contentHash,
        rationale: "Review generated output",
        source: "command",
        stagedArtifactPath: null,
        generatedByCommandId: id,
      });
      data.blueprint.verification.push(
        {
          id: `${id}-exit`,
          commandId: id,
          required: true,
          expected: "exit-zero",
          artifactPath: null,
        },
        {
          id: `${id}-diff`,
          commandId: id,
          required: true,
          expected: "no-diff",
          artifactPath: null,
        },
      );
      data.sourceTree.files.push({
        path: filePath,
        kind: "file",
        mode: "100644",
        digest: data.blueprint.filePlan[0].contentHash,
      });
    }
    data.sourceTree.files.sort((left, right) => left.path.localeCompare(right.path, "en"));
    data.result.commandResults = data.blueprint.commands.map((entry) => ({
      commandId: entry.id,
      exitCode: 0,
    }));
    data.result.finalSourceDigest = await npBuildCanonicalDigest(
      "np.build-source-tree.v1",
      data.sourceTree,
    );
    data.observation.commandResults = data.result.commandResults.map((entry) => ({
      ...entry,
      outputDigest: digest,
      durationMs: 1,
      outputArtifactPath: `.nexpress/site/audit/run-1/${entry.commandId}.json`,
    }));
    await rebindResult(data);
    const { handoff } = await createSiteBuildHandoffV1(data.input);
    expect(handoff.schema).toEqual({ generation: "recorded-pass", review: "open" });
    expect(handoff.migration).toEqual({
      generation: "recorded-pass",
      review: "open",
      appliedByHandoff: false,
      liveDatabase: "unverified",
    });
    expect(
      handoff.verification.checks
        .filter((check) => check.expected === "no-diff")
        .every((check) => check.state === "unverified"),
    ).toBe(true);
    expect(handoff.nextCommands.some((entry) => entry.argv.join(" ") === "pnpm db:generate")).toBe(
      true,
    );
  });

  it("rejects foreign brief, direction selection and blueprint bindings", async () => {
    for (const change of [
      "brief",
      "set",
      "selected",
      "projection",
      "member",
      "discovery",
    ] as const) {
      const { input, brief, blueprint } = await fixture();
      if (change === "brief") brief.unresolved = ["unresolved"];
      if (change === "set") blueprint.directionSetHash = digest;
      if (change === "selected") blueprint.selectedDirectionHash = digest;
      if (change === "projection") blueprint.selectedDirectionProjectionDigest = digest;
      if (change === "member") blueprint.selectedDirectionId = "foreign";
      if (change === "discovery") blueprint.discoveryFingerprint = "foreign";
      await expect(createSiteBuildHandoffV1(input)).rejects.toEqual(new SiteBuildError("input"));
    }
  });

  it("rejects verification, observation, source and result-path mismatches", async () => {
    for (const change of ["result", "observation", "exit", "source", "path", "output"] as const) {
      const { input, result, observation, sourceTree } = await fixture();
      if (change === "result") result.blueprintHash = digest;
      if (change === "observation") observation.manifestDigest = digest;
      if (change === "exit") observation.commandResults[0].exitCode = 1;
      if (change === "source") sourceTree.files[0].digest = `nb1:file-sha256:${"A".repeat(43)}`;
      if (change === "path")
        input.artifactPaths.verification = ".nexpress/site/review/final/foreign.json";
      if (change === "output") observation.commandResults[0].outputArtifactPath = ".env.json";
      await expect(createSiteBuildHandoffV1(input)).rejects.toEqual(new SiteBuildError("input"));
    }
  });

  it("marks recorded command failures, source gaps and explicit gates blocked", async () => {
    for (const change of ["command", "source", "gate", "risk"] as const) {
      const data = await fixture();
      if (change === "command") {
        data.result.commandResults[0].exitCode = data.observation.commandResults[0].exitCode = 1;
        await rebindResult(data);
      }
      if (change === "source") {
        data.input.verification = null;
        delete data.input.artifactPaths.verification;
        data.sourceTree.files = [];
      }
      if (change === "gate") data.input.gates = [{ id: "schema-generation", state: "blocked" }];
      if (change === "risk") {
        data.blueprint.risks.push({
          id: "migration-review",
          category: "data",
          severity: "high",
          summary: "fixture-sensitive",
          mitigation: "fixture-sensitive",
          blocking: true,
        });
        await rebindResult(data);
      }
      const { handoff, markdown } = await createSiteBuildHandoffV1(data.input);
      expect(handoff.status).toBe("blocked");
      expect(markdown).not.toContain("fixture-sensitive");
    }
  });

  it("rejects unsafe paths, environment values, gate completion assertions and conflicting outputs", async () => {
    for (const change of [
      "url",
      "credential",
      "path-alias",
      "reserved-path",
      "env-value",
      "gate-pass",
      "gate-duplicate",
      "output-conflict",
    ] as const) {
      const { input, blueprint, observation } = await fixture();
      if (change === "url") input.artifactPaths.brief = "https://private.invalid/brief.json";
      if (change === "credential") input.artifactPaths.brief = ".env.json";
      if (change === "reserved-path") input.artifactPaths.brief = "CON.json";
      if (change === "path-alias")
        input.artifactPaths.directions = input.artifactPaths.brief.toUpperCase();
      if (change === "env-value")
        Object.assign(blueprint.deployment.requiredEnvironment[0], { value: "fixture-sensitive" });
      if (change === "gate-pass")
        input.gates = [
          Object.assign({ id: "privacy" as const, state: "open" as const }, { state: "passed" }),
        ];
      if (change === "gate-duplicate")
        input.gates = [
          { id: "privacy", state: "open" },
          { id: "privacy", state: "unverified" },
        ];
      if (change === "output-conflict") {
        const second = structuredClone(observation);
        second.commandResults[0].outputDigest = `nb1:sha256:${"B".repeat(42)}A`;
        input.verification!.observations = [observation, second];
      }
      await expect(createSiteBuildHandoffV1(input)).rejects.toEqual(new SiteBuildError("input"));
    }
  });

  it("proposes the existing remote plan/preflight/release commands without URLs or execution", async () => {
    const { input } = await fixture("vercel");
    const { handoff, markdown } = await createSiteBuildHandoffV1(input);
    expect(handoff.nextCommands.find((entry) => entry.purpose === "deploy-plan")?.argv).toEqual([
      "pnpm",
      "exec",
      "nexpress",
      "deploy",
      "plan",
      "--target",
      "vercel",
      "--json",
    ]);
    expect(markdown).toContain("nexpress ops preflight --target vercel --json");
    expect(markdown).toContain("gh pr create --draft");
    expect(markdown).not.toContain("https://");
    expect(handoff.publication.deployment).toBe("unverified");
  });
});
