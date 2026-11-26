import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npRequireAgentBuildSourceTreeV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  npRequireBuildVerificationForBlueprintV1,
  npRequireBuildVerificationObservationForResultV1,
  type NpAgentBuildVerificationObservationV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";

export const siteBuildHandoffGateIdsV1 = Object.freeze([
  "schema-generation",
  "migration-generation",
  "format",
  "typecheck",
  "lint",
  "build",
  "tests",
  "doctor",
  "verification",
  "direction-previews",
  "privacy",
  "visual-review",
  "idempotency",
  "dirty-preservation",
  "postgres",
  "redis",
  "native-preview",
  "production-browser",
  "theme",
  "packed-scaffold",
  "environment",
  "deploy-preflight",
  "live-runtime",
  "launchpad",
] as const);
export type NpSiteBuildHandoffGateIdV1 = (typeof siteBuildHandoffGateIdsV1)[number];
type GateState = "open" | "unverified" | "blocked";
type CommandState = "unverified" | "recorded-pass" | "recorded-failure";
export interface NpSiteBuildHandoffInputV1 {
  brief: unknown;
  directions: unknown;
  blueprint: unknown;
  artifactPaths: { brief: string; directions: string; blueprint: string; verification?: string };
  /** Trusted local observer records; parsing alone cannot prove execution or disk contents. */
  verification: { result: unknown; observations: readonly unknown[] } | null;
  /** Optional snapshot from the existing source observer, never read by this owner. */
  sourceTree?: unknown;
  gates?: ReadonlyArray<{ id: NpSiteBuildHandoffGateIdV1; state: GateState }>;
}
export interface NpSiteBuildHandoffV1 {
  schemaVersion: "np.site-build-handoff.v1";
  status: "review-required" | "blocked";
  scope: "local-artifact-handoff";
  executable: false;
  bindings: {
    briefHash: string;
    directionSetHash: string;
    selectedDirectionId: string;
    selectedDirectionHash: string;
    selectedDirectionProjectionDigest: string;
    blueprintHash: string;
    verificationManifestDigest: string | null;
  };
  artifacts: Array<{
    role:
      | "brief"
      | "directions"
      | "blueprint"
      | "verification-result"
      | "direction-preview"
      | "verification-screenshot"
      | "verification-report"
      | "command-output";
    path: string;
    digest: string;
    digestKind: "canonical" | "file" | "recorded-output";
    evidence: "artifact-binding" | "observation-record";
  }>;
  files: Array<{
    path: string;
    action: "create" | "update";
    owner: NpAgentSiteBlueprintV1["filePlan"][number]["owner"];
    expectedHash: string | null;
    contentHash: string;
    observedHash: string | null;
    state: "planned" | "observed-match" | "observed-mismatch" | "missing";
  }>;
  requiredEnvironmentNames: string[];
  commands: Array<{ id: string; template: string; state: CommandState; exitCode: number | null }>;
  commandsNotObserved: string[];
  schema: { generation: "not-declared" | CommandState; review: "open" | "unverified" };
  migration: {
    generation: "not-declared" | CommandState;
    review: "open" | "unverified";
    appliedByHandoff: false;
    liveDatabase: "unverified";
  };
  verification: {
    state: CommandState;
    sourceSnapshot: "provided" | "unverified";
    baselineTreeDigest: string | null;
    finalSourceDigest: string | null;
    checks: Array<{
      id: string;
      required: boolean;
      expected: string;
      state: "recorded-pass" | "blocked" | "open" | "unverified";
    }>;
    observations: NpAgentBuildVerificationObservationV1[];
  };
  gates: Array<{ id: NpSiteBuildHandoffGateIdV1; state: GateState }>;
  risks: Array<{ id: string; category: string; severity: string; blocking: boolean }>;
  nextCommands: Array<{
    purpose:
      | "review"
      | "schema"
      | "migration-plan"
      | "verify"
      | "git"
      | "pull-request"
      | "deploy-plan"
      | "preflight"
      | "release-check"
      | "rollback-plan";
    argv: string[];
    execution: "not-run";
    authorization: "separate-user-instruction";
  }>;
  publication: {
    git: "unverified";
    pullRequest: "unverified";
    deployment: "unverified";
    previewUrls: [];
  };
  authority: {
    commit: false;
    push: false;
    pullRequest: false;
    deployment: false;
    migrationApply: false;
    runtimeActivation: false;
    providerCalls: false;
  };
}
const fail = (): never => {
  throw new SiteBuildError("input");
};
const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
function path(value: unknown, json = false): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    (json && !value.endsWith(".json"))
  )
    return fail();
  if (
    value
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]{1,255}$/u.test(part) ||
          part === "." ||
          part === ".." ||
          part.endsWith(".") ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part) ||
          /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|\.aws|\.ssh|\.codex|\.claude|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx)|con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(
            part,
          ),
      )
  )
    return fail();
  return value;
}
const command = (
  purpose: NpSiteBuildHandoffV1["nextCommands"][number]["purpose"],
  argv: string[],
): NpSiteBuildHandoffV1["nextCommands"][number] => ({
  purpose,
  argv,
  execution: "not-run",
  authorization: "separate-user-instruction",
});
const shell = (argv: string[]) =>
  argv
    .map((arg) =>
      /^[A-Za-z0-9@_+=:,./-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");

/**
 * Product handoff composition only. The public CLI owns source/file observation
 * and user authorization. This owner executes nothing and writes no files.
 * Supplied records are bound to exact artifacts; their presence is not a new
 * claim that a live deployment, human review, Git publication or Runtime ran.
 * Prose, logs, environment values and URLs are deliberately not copied.
 */
export async function createSiteBuildHandoffV1(
  input: NpSiteBuildHandoffInputV1,
): Promise<{ handoff: NpSiteBuildHandoffV1; markdown: string }> {
  try {
    const brief = npRequireBuildReadyBriefV1(input.brief);
    const directions = await npRequireBuildDirectionSetForBriefV1(
      brief,
      input.directions,
      "sealed",
    );
    const blueprint = await npRequireBuildBlueprintForBriefV1(brief, input.blueprint);
    const selected = directions.directions.find(
      (direction) => direction.id === blueprint.selectedDirectionId,
    );
    const directionSetHash = await npBuildCanonicalDigest(
      "np.build-design-direction-set.v1",
      directions,
    );
    if (
      !selected ||
      directionSetHash !== blueprint.directionSetHash ||
      directions.discoveryFingerprint !== blueprint.discoveryFingerprint ||
      blueprint.selectedDirectionHash !==
        (await npBuildCanonicalDigest("np.build-design-direction.v1", selected)) ||
      blueprint.selectedDirectionProjectionDigest !==
        (await npBuildCanonicalDigest(
          "np.build-design-direction-projection.v1",
          npBuildDirectionProjectionV1(selected),
        ))
    )
      return fail();
    const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
    const preview = blueprint.commands.find((entry) => entry.template === "preview-render");
    const paths = {
      brief: path(input.artifactPaths.brief, true),
      directions: path(input.artifactPaths.directions, true),
      blueprint: path(input.artifactPaths.blueprint, true),
    };
    const knownPaths = Object.values(paths).map((entry) => entry.toLowerCase());
    if (
      new Set(knownPaths).size !== knownPaths.length ||
      knownPaths.some((entry) =>
        knownPaths.some((other) => other !== entry && other.startsWith(`${entry}/`)),
      )
    )
      return fail();
    const verificationPath =
      input.artifactPaths.verification === undefined
        ? null
        : path(input.artifactPaths.verification, true);
    if (
      verificationPath &&
      (verificationPath !== preview?.verificationResultPath ||
        knownPaths.includes(verificationPath.toLowerCase()))
    )
      return fail();
    const result =
      input.verification === null
        ? null
        : await npRequireBuildVerificationForBlueprintV1(blueprint, input.verification.result);
    const observations: NpAgentBuildVerificationObservationV1[] = [];
    if (input.verification) {
      if (
        !verificationPath ||
        !Array.isArray(input.verification.observations) ||
        input.verification.observations.length > 32
      )
        return fail();
      for (const observed of input.verification.observations)
        observations.push(await npRequireBuildVerificationObservationForResultV1(result, observed));
    } else if (verificationPath) return fail();
    const source =
      input.sourceTree === undefined ? null : npRequireAgentBuildSourceTreeV1(input.sourceTree);
    const sourceDigest = source
      ? await npBuildCanonicalDigest("np.build-source-tree.v1", source)
      : null;
    if (result && sourceDigest && result.finalSourceDigest !== sourceDigest) return fail();
    const actualFiles = new Map(source?.files.map((file) => [file.path, file.digest]) ?? []);
    const files: NpSiteBuildHandoffV1["files"] = blueprint.filePlan.map((file) => {
      const observedHash = actualFiles.get(file.path) ?? null;
      return {
        path: file.path,
        action: file.action,
        owner: file.owner,
        expectedHash: file.expectedHash,
        contentHash: file.contentHash,
        observedHash,
        state: source
          ? observedHash === null
            ? "missing"
            : observedHash === file.contentHash
              ? "observed-match"
              : "observed-mismatch"
          : "planned",
      };
    });
    const recorded = observations.length > 0;
    const commands: NpSiteBuildHandoffV1["commands"] = blueprint.commands.map((entry, index) => ({
      id: entry.id,
      template: entry.template,
      state: recorded
        ? result!.commandResults[index].exitCode === 0
          ? "recorded-pass"
          : "recorded-failure"
        : "unverified",
      exitCode: recorded ? result!.commandResults[index].exitCode : null,
    }));
    const verificationState: CommandState = recorded
      ? commands.some((entry) => entry.state === "recorded-failure")
        ? "recorded-failure"
        : "recorded-pass"
      : "unverified";
    const generation = (template: string): "not-declared" | CommandState => {
      const declared = commands.filter((entry) => entry.template === template);
      return !declared.length
        ? "not-declared"
        : declared.some((entry) => entry.state === "recorded-failure")
          ? "recorded-failure"
          : declared.every((entry) => entry.state === "recorded-pass")
            ? "recorded-pass"
            : "unverified";
    };
    const checks: NpSiteBuildHandoffV1["verification"]["checks"] = blueprint.verification.map(
      (check) => {
        const observed = commands.find((entry) => entry.id === check.commandId)!;
        return {
          id: check.id,
          required: check.required,
          expected: check.expected,
          state:
            observed.state === "recorded-failure"
              ? "blocked"
              : check.expected === "exit-zero" && observed.state === "recorded-pass"
                ? "recorded-pass"
                : check.expected === "review-artifact"
                  ? "open"
                  : "unverified",
        };
      },
    );
    const gates: NpSiteBuildHandoffV1["gates"] = [];
    if (input.gates) {
      if (!Array.isArray(input.gates) || input.gates.length > siteBuildHandoffGateIdsV1.length)
        return fail();
      const seen = new Set<string>();
      for (const gate of input.gates) {
        if (
          !siteBuildHandoffGateIdsV1.includes(gate.id) ||
          !["open", "unverified", "blocked"].includes(gate.state) ||
          seen.has(gate.id)
        )
          return fail();
        seen.add(gate.id);
        gates.push({ id: gate.id, state: gate.state });
      }
    }
    gates.sort((left, right) => compare(left.id, right.id));
    const artifacts: NpSiteBuildHandoffV1["artifacts"] = [];
    const add = (artifact: NpSiteBuildHandoffV1["artifacts"][number]) => {
      path(artifact.path);
      const folded = artifact.path.toLowerCase();
      if (
        artifacts.some(
          (entry) =>
            entry.path.toLowerCase().startsWith(`${folded}/`) ||
            folded.startsWith(`${entry.path.toLowerCase()}/`),
        )
      )
        return fail();
      const prior = artifacts.find(
        (entry) => entry.path.toLowerCase() === artifact.path.toLowerCase(),
      );
      if (prior) {
        if (
          prior.path !== artifact.path ||
          prior.digest !== artifact.digest ||
          prior.role !== artifact.role ||
          prior.digestKind !== artifact.digestKind
        )
          return fail();
        return;
      }
      artifacts.push(artifact);
    };
    add({
      role: "brief",
      path: paths.brief,
      digest: blueprint.briefHash,
      digestKind: "canonical",
      evidence: "artifact-binding",
    });
    add({
      role: "directions",
      path: paths.directions,
      digest: directionSetHash,
      digestKind: "canonical",
      evidence: "artifact-binding",
    });
    add({
      role: "blueprint",
      path: paths.blueprint,
      digest: blueprintHash,
      digestKind: "canonical",
      evidence: "artifact-binding",
    });
    for (const direction of directions.directions)
      for (const image of [direction.previewArtifact.desktop, direction.previewArtifact.mobile])
        add({
          role: "direction-preview",
          path: image.relativePath,
          digest: image.digest,
          digestKind: "file",
          evidence: "artifact-binding",
        });
    if (result) {
      add({
        role: "verification-result",
        path: verificationPath!,
        digest: result.manifestDigest,
        digestKind: "canonical",
        evidence: recorded ? "observation-record" : "artifact-binding",
      });
      for (const artifact of result.artifacts)
        add({
          role: artifact.kind === "screenshot" ? "verification-screenshot" : "verification-report",
          path: artifact.path,
          digest: artifact.digest,
          digestKind: "file",
          evidence: recorded ? "observation-record" : "artifact-binding",
        });
    }
    for (const observed of observations)
      for (const output of observed.commandResults)
        add({
          role: "command-output",
          path: output.outputArtifactPath,
          digest: output.outputDigest,
          digestKind: "recorded-output",
          evidence: "observation-record",
        });
    artifacts.sort((left, right) => compare(left.path, right.path));
    const formatFiles = [
      ...new Set(
        blueprint.commands.flatMap((entry) => (entry.template === "format" ? entry.files : [])),
      ),
    ].sort(compare);
    const hasSeedContinuation = ["site-build.seed.json", "scripts/seed-content.ts"].every((path) =>
      files.some((file) => file.path === path && file.owner === "seed"),
    );
    const nextCommands = [
      command("review", ["git", "status", "--short"]),
      command("review", ["git", "diff", "--check"]),
      command("review", ["git", "diff", "--", ...files.map((file) => file.path)]),
      command("schema", ["pnpm", "run", "schema:gen"]),
      command("schema", ["pnpm", "db:generate"]),
      command("migration-plan", ["pnpm", "exec", "nexpress", "ops", "migrate", "plan", "--json"]),
      ...(formatFiles.length
        ? [command("verify", ["pnpm", "exec", "prettier", "--check", "--", ...formatFiles])]
        : []),
      command("verify", ["pnpm", "run", "typecheck"]),
      command("verify", ["pnpm", "exec", "eslint", ".", "--no-cache"]),
      command("verify", ["pnpm", "exec", "vitest", "run"]),
      command("verify", ["pnpm", "run", "build"]),
      command("verify", ["pnpm", "run", "doctor"]),
      ...(hasSeedContinuation ? [command("review", ["pnpm", "run", "seed:content"])] : []),
      command("review", ["pnpm", "run", "dev"]),
      command("git", ["git", "add", "--", ...files.map((file) => file.path)]),
      command("git", ["git", "commit"]),
      command("git", ["git", "push", "--set-upstream", "origin", "<reviewed-branch>"]),
      command("pull-request", ["gh", "pr", "create", "--draft"]),
      command("rollback-plan", [
        "pnpm",
        "exec",
        "nexpress",
        "ops",
        "migrate",
        "rollback-plan",
        "--json",
      ]),
    ];
    if (blueprint.deployment.target !== "local")
      for (const [purpose, argv] of [
        [
          "deploy-plan",
          [
            "pnpm",
            "exec",
            "nexpress",
            "deploy",
            "plan",
            "--target",
            blueprint.deployment.target,
            "--json",
          ],
        ],
        [
          "preflight",
          [
            "pnpm",
            "exec",
            "nexpress",
            "ops",
            "preflight",
            "--target",
            blueprint.deployment.target,
            "--json",
          ],
        ],
        [
          "release-check",
          [
            "pnpm",
            "exec",
            "nexpress",
            "release",
            "check",
            "--target",
            blueprint.deployment.target,
            "--json",
          ],
        ],
      ] as const)
        nextCommands.push(command(purpose, [...argv]));
    const blocked =
      files.some((file) => file.state === "missing" || file.state === "observed-mismatch") ||
      result?.commandResults.some((entry) => entry.exitCode !== 0) ||
      gates.some((gate) => gate.state === "blocked") ||
      blueprint.risks.some((risk) => risk.blocking);
    const handoff: NpSiteBuildHandoffV1 = {
      schemaVersion: "np.site-build-handoff.v1",
      status: blocked ? "blocked" : "review-required",
      scope: "local-artifact-handoff",
      executable: false,
      bindings: {
        briefHash: blueprint.briefHash,
        directionSetHash,
        selectedDirectionId: selected.id,
        selectedDirectionHash: blueprint.selectedDirectionHash,
        selectedDirectionProjectionDigest: blueprint.selectedDirectionProjectionDigest,
        blueprintHash,
        verificationManifestDigest: result?.manifestDigest ?? null,
      },
      artifacts,
      files,
      requiredEnvironmentNames: [
        ...new Set([
          ...blueprint.deployment.requiredEnvironment.map((entry) => entry.name),
          ...blueprint.plugins.flatMap((plugin) => plugin.configPlaceholders),
        ]),
      ].sort(compare),
      commands,
      commandsNotObserved: commands
        .filter((entry) => entry.state === "unverified")
        .map((entry) => entry.id),
      schema: {
        generation: generation("schema-generate"),
        review: generation("schema-generate") === "recorded-pass" ? "open" : "unverified",
      },
      migration: {
        generation: generation("migration-generate"),
        review: generation("migration-generate") === "recorded-pass" ? "open" : "unverified",
        appliedByHandoff: false,
        liveDatabase: "unverified",
      },
      verification: {
        state: verificationState,
        sourceSnapshot: source ? "provided" : "unverified",
        baselineTreeDigest: result?.baselineTreeDigest ?? null,
        finalSourceDigest: sourceDigest ?? result?.finalSourceDigest ?? null,
        checks,
        observations,
      },
      gates,
      risks: blueprint.risks.map(({ id, category, severity, blocking }) => ({
        id,
        category,
        severity,
        blocking,
      })),
      nextCommands,
      publication: {
        git: "unverified",
        pullRequest: "unverified",
        deployment: "unverified",
        previewUrls: [],
      },
      authority: {
        commit: false,
        push: false,
        pullRequest: false,
        deployment: false,
        migrationApply: false,
        runtimeActivation: false,
        providerCalls: false,
      },
    };
    const markdown = renderMarkdown(handoff);
    if (
      Buffer.byteLength(JSON.stringify(handoff)) > 2 * 1024 * 1024 ||
      Buffer.byteLength(markdown) > 2 * 1024 * 1024
    )
      return fail();
    return { handoff, markdown };
  } catch {
    return fail();
  }
}

function renderMarkdown(value: NpSiteBuildHandoffV1): string {
  const rows = [
    "# Local Build handoff",
    "",
    `Status: **${value.status}**. Verification: **${value.verification.state}**.`,
    "",
    "This document binds supplied local artifacts and observation records. Artifact bytes, human review, Git/PR state and live services are not re-observed here. Commands below have not been run by this handoff and require a separate user instruction.",
    "",
    `Selected direction: \`${value.bindings.selectedDirectionId}\``,
    `Blueprint: \`${value.bindings.blueprintHash}\``,
    "",
    "## Artifacts",
    "",
    "| Role | Path | Digest | Evidence |",
    "| --- | --- | --- | --- |",
    ...value.artifacts.map(
      (entry) => `| ${entry.role} | \`${entry.path}\` | \`${entry.digest}\` | ${entry.evidence} |`,
    ),
    "",
    "## Files and ownership",
    "",
    "| Path | Owner | Planned action | Content hash | State |",
    "| --- | --- | --- | --- | --- |",
    ...value.files.map(
      (entry) =>
        `| \`${entry.path}\` | ${entry.owner} | ${entry.action} | \`${entry.contentHash}\` | ${entry.state} |`,
    ),
    "",
    "## Environment variable names",
    "",
    ...(value.requiredEnvironmentNames.length
      ? value.requiredEnvironmentNames.map((name) => `- \`${name}\``)
      : ["No variable names are declared in the bound blueprint."]),
    "",
    "## Schema, migrations and verification",
    "",
    `Schema generation: ${value.schema.generation}; review: ${value.schema.review}.`,
    `Migration generation: ${value.migration.generation}; review: ${value.migration.review}. Production application: unverified; this handoff applies no migrations.`,
    "",
    ...value.commands.map(
      (entry) =>
        `- \`${entry.id}\` (${entry.template}): ${entry.state}${entry.exitCode === null ? "" : `; recorded exit ${entry.exitCode}`}`,
    ),
    "",
    "Checks that require human review or independent evidence remain open/unverified:",
    ...value.verification.checks
      .filter((entry) => entry.state !== "recorded-pass")
      .map((entry) => `- \`${entry.id}\` (${entry.expected}): ${entry.state}`),
    "",
    "## Known gates and risks",
    "",
    ...(value.gates.length
      ? value.gates.map((gate) => `- ${gate.id}: ${gate.state}`)
      : [
          "No additional gate observations supplied; this does not mean the acceptance matrix passed.",
        ]),
    ...value.risks.map(
      (risk) =>
        `- Risk \`${risk.id}\`: ${risk.category}/${risk.severity}; blocking: ${risk.blocking}`,
    ),
    "",
    "Review the bound brief and blueprint for assumptions, risk descriptions and contract details. No preview URL, PR URL or deployment URL has been asserted.",
    "",
    "## Resume the ordinary local site",
    "",
    "Resolve blocked gates and review the generated schema and migration SQL first. Configure the named environment variables locally, confirm the intended local PostgreSQL database already has the reviewed migrations, and use an existing site and Admin account. This handoff does not apply migrations, create an Admin, or start a server.",
    "",
    "Use the installed project tools for format, typecheck, lint, tests, build and Doctor below. The ordinary scaffold does not require a monorepo verify script. Invoke Doctor with `pnpm run doctor` so the package script runs instead of pnpm's built-in command.",
    "",
    ...(value.nextCommands.some((entry) => entry.argv.join(" ") === "pnpm run seed:content")
      ? [
          "After reviewing the bound `site-build.seed.json` and `scripts/seed-content.ts`, run `pnpm run seed:content` exclusively against that prepared local database. It writes content, theme and navigation through the normal owners and requires an existing Admin. It defaults to the existing default site; for another existing site, pass `--site=<site-id>` as its one argument. A conflicting rerun must be reviewed before continuing.",
          "",
        ]
      : []),
    "Run `pnpm run dev` to resume the local site, then open `/admin` on that local server and sign in with the existing Admin to continue editing. Local content preparation and server startup below are separate manual steps, not read-only inspections or observed execution. Review the resulting Git diff before publication. Deployment remains a separate decision.",
    "",
    "## Next commands — not run",
    "",
    ...value.nextCommands.flatMap((entry) => [
      `${entry.purpose}:`,
      "",
      "```sh",
      shell(entry.argv),
      "```",
      "",
    ]),
    "## Rollback and continuation",
    "",
    "Review the Git diff and preserve unrelated or dirty files. Revert only a reviewed commit after a separate instruction. Use the existing migration rollback-plan before any database rollback. Continue with the bound ordinary repository files, schemas, migrations and deployment contracts. No Runtime activation, worker activation or provider authority is granted.",
    "",
  ];
  return rows.join("\n");
}
