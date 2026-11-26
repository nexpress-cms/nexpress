import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npBuildInstalledCatalogBytesV1,
  npBuildDesignDirectionDraftSetBytesV1,
  npBuildDirectionProjectionV1,
  npBuildDirectionLimitsV1,
  npParseAgentDesignDirectionDraftSetV1,
  npParseAgentSiteBriefV1,
  npParseAgentSiteBlueprintV1,
  npRequireAgentSiteBriefV1,
  npRequireBuildBlueprintForBriefV1,
  type NpAgentSiteBriefV1,
} from "@nexpress/core/agent-contract";
import { projectSiteBuildBrowserDiagnosticV1 } from "./browser-request-diagnostic.js";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { NP_SITE_BUILD_SKILL_V1 } from "./skill.js";
import { runSiteBuildRenderOperationV1 } from "./direction-command.js";
import { runSiteBuildPlanValidationV1 } from "./plan-command.js";
import { runSiteBuildSeedSourceV1 } from "./seed-command.js";
import {
  runSiteBuildCodegenSourceV1,
  NpSiteBuildCodegenSourceFailureV1,
} from "./codegen-command.js";
import { runSiteBuildHandoffExportV1 } from "./handoff-command.js";
import {
  runSiteBuildGenerateV1,
  NpSiteBuildGenerateEnvironmentMismatchV1,
  NpSiteBuildGenerateFailureV1,
  NpSiteBuildGenerateSourcePreconditionConflictV1,
} from "./generator-command.js";
import { NpSiteBuildGeneratorControllerErrorV1 } from "./generator-controller.js";
import { SiteBuildLinuxSandboxFailureV1 } from "./linux-sandbox.js";
import {
  NpSiteBuildDirectionArtifactPublicationErrorV1,
  NpSiteBuildFinalArtifactPublicationErrorV1,
} from "./render-artifacts.js";
import {
  observeSiteBuildCatalogV1,
  observeSiteBuildDirectionDraftSetV1,
} from "./catalog-worker.js";

export const SITE_BUILD_HELP_V1 = `Usage:
  nexpress site brief init --out .nexpress/site/brief.template.json
  nexpress site brief validate --file <project-relative.json> --out .nexpress/site/brief.canonical.json
  nexpress site proposal validate --brief <brief.json> --blueprint <blueprint.json> --out .nexpress/site/blueprint.proposal.json
  nexpress site catalog inspect --config <nexpress.config.ts|src/nexpress.config.ts> --out .nexpress/site/catalog.json
  nexpress site directions validate --brief <brief.json> --drafts <draft-set.json> --config <nexpress.config.ts|src/nexpress.config.ts> --out .nexpress/site/drafts.validated.json
  nexpress site renderer prepare --config <config.ts> --fixtures <fixture-files.json> --out .nexpress/site/runtime.json --catalog-out .nexpress/site/render-catalog.json
  nexpress site direction render --brief <brief.json> --draft <draft-set.json> --runtime <runtime.json> --out .nexpress/site/directions.json
  nexpress site direction validate --brief <brief.json> --file <sealed-set.json> --runtime <runtime.json> --out .nexpress/site/directions.canonical.json
  nexpress site fixture inspect --brief <brief.json> --draft <draft-set.json> --direction <id> --runtime <runtime.json> --out .nexpress/site/projected-fixture.json
  nexpress site plan validate --brief <brief.json> --directions <sealed-set.json> --blueprint <blueprint.json> --runtime <runtime.json> --out .nexpress/site/blueprint.validated.json
  nexpress site seed source --brief <brief.json> --directions <sealed-set.json> --blueprint <provisional-blueprint.json> --runtime <runtime.json> --out .nexpress/site/seed-source.json
  nexpress site codegen source --brief <brief.json> --directions <sealed-set.json> --blueprint <provisional-blueprint.json> --runtime <runtime.json> --out .nexpress/site/codegen-source.json
  nexpress site generate --brief <brief.json> --directions <sealed-set.json> --blueprint <blueprint.json> --runtime <runtime.json> --out .nexpress/site/review/final/generation.json [--execute --acknowledge-plan <exact-blueprint-hash>]
  nexpress site handoff export --brief <brief.json> --directions <sealed-set.json> --blueprint <blueprint.json> [--verification <result.json>] [--observations <observations.json>] --out .nexpress/site/review/final/handoff.json
  nexpress site skill install --client <codex|claude> [--apply]

Results are JSON. Proposal checks establish format and brief binding only.
Outputs are create-only or byte-identical; use a new path for revised content.
Catalog inspection loads installed declarations in a supported isolated worker.
Direction validation resolves installed templates, patterns and actual block props; it does not render images.
Render preparation uses Docker to build a private Linux copy of the normal scaffold.
Rendering uses fresh synthetic PostgreSQL databases and Chromium; Runtime services stay disabled.
Generation verifies a private copy by default. Execute requires the exact plan hash and publishes only reviewed source changes after verification.
`;

export function createSiteBriefTemplateV1(): NpAgentSiteBriefV1 {
  return npRequireAgentSiteBriefV1({
    schemaVersion: "np.agent-site-brief.v1",
    project: {
      name: "Site name",
      summary: "Describe the intended site.",
      primaryGoal: "Describe the primary outcome.",
      successSignals: [],
    },
    audience: [],
    content: [],
    pages: [],
    features: [],
    locales: [],
    design: { adjectives: [], avoid: [], references: [], accessibility: "AA" },
    operations: {
      target: "local",
      expectedEditors: null,
      expectedMembers: null,
      agentOperation: false,
    },
    constraints: [],
    assumptions: [],
    unresolved: [
      "Confirm product, audience and public/member authorship.",
      "Confirm content model, required pages and locale strategy.",
      "Confirm design direction, deployment and storage requirements.",
    ],
  });
}

function flags(
  args: string[],
  required: readonly string[],
  optional: readonly string[] = [],
): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [flag, ...rest] = args[i].split("=");
    if (values.has(flag) || ![...required, ...optional].includes(flag))
      throw new SiteBuildError("arguments");
    if (flag === "--apply" || flag === "--execute") {
      if (rest.length) throw new SiteBuildError("arguments");
      values.set(flag, "true");
    } else {
      const value = rest.length ? rest.join("=") : args[++i];
      if (!value || value.startsWith("-")) throw new SiteBuildError("arguments");
      values.set(flag, value);
    }
  }
  if (required.some((flag) => !values.has(flag))) throw new SiteBuildError("arguments");
  return values;
}

const decode = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export async function runSiteCommandV1(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = (body: unknown) => ({
    code: 0,
    stdout: `${JSON.stringify(body, null, 2)}\n`,
    stderr: "",
  });
  try {
    if (
      args.length === 0 ||
      (args.length === 1 && ["--help", "-h"].includes(args[0])) ||
      (args.length === 2 && args[0] === "generate" && ["--help", "-h"].includes(args[1])) ||
      (args.length === 3 &&
        ["--help", "-h"].includes(args[2]) &&
        [
          "brief init",
          "brief validate",
          "proposal validate",
          "catalog inspect",
          "directions validate",
          "renderer prepare",
          "direction render",
          "direction validate",
          "fixture inspect",
          "plan validate",
          "seed source",
          "codegen source",
          "handoff export",
          "skill install",
        ].includes(args.slice(0, 2).join(" ")))
    )
      return { code: 0, stdout: SITE_BUILD_HELP_V1, stderr: "" };
    if (args[0] === "generate")
      return result(
        await runSiteBuildGenerateV1(
          flags(
            args.slice(1),
            ["--brief", "--directions", "--blueprint", "--runtime", "--out"],
            ["--execute", "--acknowledge-plan"],
          ),
          cwd,
        ),
      );
    const operation = args.slice(0, 2).join(" ");
    if (operation === "codegen source")
      return result(
        await runSiteBuildCodegenSourceV1(
          flags(args.slice(2), ["--brief", "--directions", "--blueprint", "--runtime", "--out"]),
          cwd,
        ),
      );
    if (operation === "seed source")
      return result(
        await runSiteBuildSeedSourceV1(
          flags(args.slice(2), ["--brief", "--directions", "--blueprint", "--runtime", "--out"]),
          cwd,
        ),
      );
    if (operation === "handoff export")
      return result(
        await runSiteBuildHandoffExportV1(
          flags(
            args.slice(2),
            ["--brief", "--directions", "--blueprint", "--out"],
            ["--verification", "--observations"],
          ),
          cwd,
        ),
      );
    if (operation === "plan validate")
      return result(
        await runSiteBuildPlanValidationV1(
          flags(args.slice(2), ["--brief", "--directions", "--blueprint", "--runtime", "--out"]),
          cwd,
        ),
      );
    if (
      ["renderer prepare", "direction render", "direction validate", "fixture inspect"].includes(
        operation,
      )
    ) {
      const required =
        operation === "renderer prepare"
          ? ["--config", "--fixtures", "--out", "--catalog-out"]
          : [
              "--brief",
              operation === "direction validate" ? "--file" : "--draft",
              "--runtime",
              "--out",
              ...(operation === "fixture inspect" ? ["--direction"] : []),
            ];
      const options = flags(
        args.slice(2),
        required,
        operation === "direction render" ? ["--review-dir"] : [],
      );
      return result(await runSiteBuildRenderOperationV1(operation, options, cwd));
    }
    if (operation === "directions validate") {
      const options = flags(args.slice(2), ["--brief", "--drafts", "--config", "--out"]);
      const files = await SiteArtifactFiles.at(cwd);
      const brief = npParseAgentSiteBriefV1(
        decode(await files.read(options.get("--brief")!, npBuildContractLimitsV1.brief.bytes)),
      );
      const set = npParseAgentDesignDirectionDraftSetV1(
        decode(await files.read(options.get("--drafts")!, npBuildDirectionLimitsV1.set.bytes)),
      );
      const observed = await observeSiteBuildDirectionDraftSetV1(
        cwd,
        options.get("--config")!,
        brief,
        set,
      );
      const path = options.get("--out")!;
      const status = await files.write(
        path,
        npBuildDesignDirectionDraftSetBytesV1(observed.draftSet),
      );
      const projections = [];
      for (const direction of observed.draftSet.directions)
        projections.push({
          id: direction.id,
          digest: await npBuildCanonicalDigest(
            "np.build-design-direction-projection.v1",
            npBuildDirectionProjectionV1(direction),
          ),
        });
      return result({
        schemaVersion: "np.site-build-cli-result.v1",
        operation,
        status,
        path,
        fingerprint: observed.fingerprint,
        projections,
        validationScope: observed.validationScope,
        executable: false,
        renderedImages: 0,
      });
    }
    if (operation === "catalog inspect") {
      const options = flags(args.slice(2), ["--config", "--out"]);
      const observed = await observeSiteBuildCatalogV1(cwd, options.get("--config")!);
      const bytes = await npBuildInstalledCatalogBytesV1(observed.catalog);
      const path = options.get("--out")!;
      const status = await (await SiteArtifactFiles.at(cwd)).write(path, bytes.canonicalJsonUtf8);
      return result({
        schemaVersion: "np.site-build-cli-result.v1",
        operation,
        status,
        path,
        fingerprint: observed.fingerprint,
        validationScope: observed.validationScope,
        executable: observed.executable,
      });
    }
    if (operation === "skill install") {
      const options = flags(args.slice(2), ["--client"], ["--apply"]);
      const client = options.get("--client");
      if (client !== "codex" && client !== "claude") throw new SiteBuildError("arguments");
      const path = `${client === "codex" ? ".agents" : ".claude"}/skills/nexpress-site-build/SKILL.md`;
      const status = options.has("--apply")
        ? await (await SiteArtifactFiles.at(cwd)).write(path, encode(NP_SITE_BUILD_SKILL_V1), true)
        : "planned";
      return result({ schemaVersion: "np.site-build-cli-result.v1", operation, status, path });
    }
    const required =
      operation === "brief init"
        ? ["--out"]
        : operation === "brief validate"
          ? ["--file", "--out"]
          : operation === "proposal validate"
            ? ["--brief", "--blueprint", "--out"]
            : null;
    if (!required) throw new SiteBuildError("arguments");
    const options = flags(args.slice(2), required);
    const files = await SiteArtifactFiles.at(cwd);
    const path = options.get("--out")!;
    if (operation === "proposal validate") {
      const brief = npParseAgentSiteBriefV1(
        decode(await files.read(options.get("--brief")!, npBuildContractLimitsV1.brief.bytes)),
      );
      const blueprint = await npRequireBuildBlueprintForBriefV1(
        brief,
        npParseAgentSiteBlueprintV1(
          decode(
            await files.read(options.get("--blueprint")!, npBuildContractLimitsV1.blueprint.bytes),
          ),
        ),
      );
      const bytes = npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint);
      const digest = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
      const status = await files.write(path, bytes.canonicalJsonUtf8);
      return result({
        schemaVersion: "np.site-build-cli-result.v1",
        operation,
        status,
        path,
        digest,
        validationScope: "proposal-only",
        executable: false,
      });
    }
    const brief =
      operation === "brief init"
        ? createSiteBriefTemplateV1()
        : npParseAgentSiteBriefV1(
            decode(await files.read(options.get("--file")!, npBuildContractLimitsV1.brief.bytes)),
          );
    const bytes = npBuildCanonicalBytes("np.build-site-brief.v1", brief);
    const digest = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
    const status = await files.write(path, bytes.canonicalJsonUtf8);
    return result({
      schemaVersion: "np.site-build-cli-result.v1",
      operation,
      status,
      path,
      digest,
      unresolvedCount: brief.unresolved.length,
      validationScope: "proposal-only",
      executable: false,
    });
  } catch (error) {
    const reason = error instanceof SiteBuildError ? error.reason : "input";
    const details =
      error instanceof NpSiteBuildGenerateSourcePreconditionConflictV1
        ? {
            scope: error.scope,
            conflicts: error.conflicts,
            sourceWrites: error.sourceWrites,
            requiresNewReviewedPlan: error.requiresNewReviewedPlan,
          }
        : error instanceof SiteBuildLinuxSandboxFailureV1
          ? {
              nativeAudit: {
                status: error.audit.status,
                reason: error.audit.reason,
                rootExitCode: error.audit.rootExitCode,
                rootSignal: error.audit.rootSignal,
                tracedProcesses: error.audit.tracedProcesses,
                reapedProcesses: error.audit.reapedProcesses,
                descendantsReaped: error.audit.descendantsReaped,
                argumentsFrozen: error.audit.argumentsFrozen,
                ownIpcReclaimed: error.audit.ownIpcReclaimed,
                forbiddenAttempts: error.audit.forbiddenAttempts,
              },
              failurePhase: {
                driver: error.driverStage,
                browser: error.browserPhase,
                browserDiagnostic: projectSiteBuildBrowserDiagnosticV1(error.browserDiagnostic),
                fixture: error.fixtureStage,
                reason: error.fixtureReason,
                location: error.fixtureLocation,
                http: error.previewHttpDiagnostic,
              },
            }
          : error instanceof NpSiteBuildCodegenSourceFailureV1
            ? {
                stage: error.stage,
                retention: error.retention,
                privateCopy: error.privateCopy,
                retainedPaths: error.retainedPaths,
                sourceWrites: error.sourceWrites,
              }
            : error instanceof NpSiteBuildGenerateEnvironmentMismatchV1
              ? {
                  expectedRenderEnvironment: error.expected,
                  currentRenderEnvironment: error.current,
                  retainedPaths: error.retainedPaths,
                  requiresNewReviewedPlan: true,
                }
              : error instanceof NpSiteBuildGeneratorControllerErrorV1
                ? {
                    stage: error.stage,
                    sourcePublication: error.sourcePublication,
                    privateCopy: error.privateCopy,
                    failureEvidence: error.failureEvidence,
                    ...(error instanceof NpSiteBuildGenerateFailureV1
                      ? { retainedPaths: error.retainedPaths }
                      : {}),
                  }
                : error instanceof NpSiteBuildDirectionArtifactPublicationErrorV1
                  ? {
                      publicationState: error.publicationState,
                      sealedSetState: error.sealedSetState,
                    }
                  : error instanceof NpSiteBuildFinalArtifactPublicationErrorV1
                    ? {
                        publicationState: error.publicationState,
                        manifestState: error.manifestState,
                      }
                    : {};
    const messages = {
      arguments: "Use one advertised command with its exact, non-repeated flags.",
      path: "Use a portable project-relative JSON path and the advertised command-specific output location below .nexpress/site.",
      input:
        "Artifacts or installed declarations did not satisfy bounded validation and isolation requirements. Links and unstable inputs are not accepted.",
      conflict: "Existing output differs. Preserve it and choose a new output filename.",
      unavailable:
        "This host or installed project lacks the required supported file or isolation operation.",
    } as const;
    const message =
      error instanceof NpSiteBuildGenerateSourcePreconditionConflictV1
        ? "Source files no longer match this plan's preconditions. Review the reported files and create a new reviewed plan."
        : messages[reason];
    // Paths, raw arguments, schema prose and filesystem errors may contain secrets.
    return {
      code: reason === "arguments" ? 2 : 1,
      stdout: "",
      stderr: `${JSON.stringify({ schemaVersion: "np.site-build-cli-error.v1", reason, message, ...details })}\n${reason === "arguments" ? SITE_BUILD_HELP_V1 : ""}`,
    };
  }
}
