import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npBuildDirectionLimitsV1,
  npBuildFileDigest,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBlueprintV1,
  npParseAgentSiteBriefV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildPreviewReportForBlueprintV1,
  npRequireBuildReadyBriefV1,
  npRequireBuildVerificationForBlueprintV1,
  npRequireBuildVerificationObservationForResultV1,
  type NpAgentBuildVerificationObservationV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { createSiteBuildHandoffV1 } from "./build-handoff.js";
import {
  NpSiteBuildFinalArtifactPublicationErrorV1,
  publishSiteBuildFinalArtifactsV1,
} from "./render-artifacts.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const decode = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function requireImageMime(bytes: Uint8Array, mime: "image/png" | "image/webp") {
  const value = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const actual =
    value.length >= 8 && value.subarray(0, 8).equals(png)
      ? "image/png"
      : value.length >= 20 &&
          value.toString("ascii", 0, 4) === "RIFF" &&
          value.readUInt32LE(4) + 8 === value.length &&
          value.toString("ascii", 8, 12) === "WEBP" &&
          ["VP8 ", "VP8L", "VP8X"].includes(value.toString("ascii", 12, 16))
        ? "image/webp"
        : null;
  if (actual !== mime) throw new SiteBuildError("input");
}
/**
 * Observe/export supplied local records only. No command, browser, provider, Git,
 * Runtime, migration or deployment runs. Rehashed bytes do not authenticate their
 * recorded producer, human approval, historical execution or current runtime.
 */
export async function runSiteBuildHandoffExportV1(values: Map<string, string>, cwd: string) {
  const args = new Map(values),
    required = ["--brief", "--directions", "--blueprint", "--out"],
    optional = ["--verification", "--observations"];
  if (
    required.some((key) => !args.get(key)) ||
    [...args].some(([key, value]) => ![...required, ...optional].includes(key) || !value) ||
    (args.has("--observations") && !args.has("--verification"))
  )
    throw new SiteBuildError("arguments");
  const out = args.get("--out")!;
  if (
    out.length > 240 ||
    !/^\.nexpress\/site\/review\/final\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u.test(
      out,
    )
  )
    throw new SiteBuildError("path");
  const project = await realpath(cwd),
    files = await SiteArtifactFiles.at(project),
    source = await readSiteSourceTreeV1(project);
  type Read = { kind: "json" | "direction" | "final"; max: number; bytes: number; sha256: string };
  const references = new Map<string, Read>();
  const read = async (path: string, kind: Read["kind"], max: number) => {
    const bytes =
      kind === "direction"
        ? await files.readReviewPng(path)
        : kind === "final"
          ? await files.readFinalPreviewImage(path, max)
          : await files.read(path, max);
    const observed = { kind, max, bytes: bytes.length, sha256: sha(bytes) },
      prior = references.get(path);
    if (prior && (prior.bytes !== observed.bytes || prior.sha256 !== observed.sha256))
      throw new SiteBuildError("conflict");
    references.set(path, observed);
    return bytes;
  };
  const brief = npRequireBuildReadyBriefV1(
    npParseAgentSiteBriefV1(
      decode(await read(args.get("--brief")!, "json", npBuildContractLimitsV1.brief.bytes)),
    ),
  );
  const directions = await npRequireBuildDirectionSetForBriefV1(
    brief,
    npParseAgentDesignDirectionSetV1(
      decode(await read(args.get("--directions")!, "json", npBuildDirectionLimitsV1.set.bytes)),
    ),
    "sealed",
  );
  const blueprint = await npRequireBuildBlueprintForBriefV1(
    brief,
    npParseAgentSiteBlueprintV1(
      decode(await read(args.get("--blueprint")!, "json", npBuildContractLimitsV1.blueprint.bytes)),
    ),
  );
  for (const direction of directions.directions)
    for (const image of [direction.previewArtifact.desktop, direction.previewArtifact.mobile]) {
      if (image.mime !== "image/png") throw new SiteBuildError("unavailable");
      const bytes = await read(image.relativePath, "direction", 10 * 1024 * 1024);
      requireImageMime(bytes, image.mime);
      if (
        bytes.length !== image.bytes ||
        (await npBuildFileDigest("np.build-preview-artifact.v1", bytes)) !== image.digest
      )
        throw new SiteBuildError("conflict");
    }
  const verificationPath = args.get("--verification"),
    observations: NpAgentBuildVerificationObservationV1[] = [];
  const verification = verificationPath
    ? await npRequireBuildVerificationForBlueprintV1(
        blueprint,
        JSON.parse(decode(await read(verificationPath, "json", 2 * 1024 * 1024))),
      )
    : null;
  if (verification) {
    // Reject the declared aggregate before opening or allocating any screenshot.
    if (
      verification.artifacts.length > 401 ||
      verification.artifacts.reduce((total, file) => total + file.bytes, 0) > 512 * 1024 * 1024
    )
      throw new SiteBuildError("input");
    for (const artifact of verification.artifacts) {
      const bytes = await read(
        artifact.path,
        artifact.kind === "screenshot" ? "final" : "json",
        artifact.kind === "screenshot" ? artifact.bytes : 512 * 1024,
      );
      if (
        bytes.length !== artifact.bytes ||
        (await npBuildFileDigest("np.build-verification-artifact.v1", bytes)) !== artifact.digest
      )
        throw new SiteBuildError("conflict");
      if (artifact.kind === "screenshot") requireImageMime(bytes, artifact.mime);
      else await npRequireBuildPreviewReportForBlueprintV1(blueprint, JSON.parse(decode(bytes)));
    }
    const observationsPath = args.get("--observations");
    if (observationsPath) {
      const recorded: unknown = JSON.parse(
        decode(await read(observationsPath, "json", 2 * 1024 * 1024)),
      );
      // `site generate` writes one observation record. Keep the bounded array
      // form for separately collected runs without requiring a wrapper edit.
      const records = Array.isArray(recorded) ? recorded : [recorded];
      if (records.length > 32) throw new SiteBuildError("input");
      for (const value of records) {
        const observation = await npRequireBuildVerificationObservationForResultV1(
          verification,
          value,
        );
        for (const command of observation.commandResults) {
          const output = npRequireAgentBuildCommandOutputV1(
            JSON.parse(
              decode(
                await read(
                  command.outputArtifactPath,
                  "json",
                  npBuildContractLimitsV1.output.bytes,
                ),
              ),
            ),
          );
          if (
            (await npBuildCanonicalDigest("np.build-command-output.v1", output)) !==
            command.outputDigest
          )
            throw new SiteBuildError("conflict");
        }
        observations.push(observation);
      }
    }
  }
  const envelope = await createSiteBuildHandoffV1({
    brief,
    directions,
    blueprint,
    artifactPaths: {
      brief: args.get("--brief")!,
      directions: args.get("--directions")!,
      blueprint: args.get("--blueprint")!,
      ...(verificationPath ? { verification: verificationPath } : {}),
    },
    verification: verification ? { result: verification, observations } : null,
    sourceTree: source.manifest,
  });
  if ([...references.keys()].some((path) => path.toLowerCase() === out.toLowerCase()))
    throw new SiteBuildError("path");
  const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  if (bytes.length > 4 * 1024 * 1024) throw new SiteBuildError("input");
  const assertUnchanged = async () => {
    for (const [path, observed] of references) {
      const bytes =
        observed.kind === "direction"
          ? await files.readReviewPng(path)
          : observed.kind === "final"
            ? await files.readFinalPreviewImage(path, observed.max)
            : await files.read(path, observed.max);
      if (bytes.length !== observed.bytes || sha(bytes) !== observed.sha256)
        throw new SiteBuildError("conflict");
    }
    if ((await readSiteSourceTreeV1(project)).digest !== source.digest)
      throw new SiteBuildError("conflict");
  };
  await assertUnchanged();
  const publication = await publishSiteBuildFinalArtifactsV1({
    project,
    artifacts: [],
    manifest: { path: out, bytes },
  });
  try {
    await assertUnchanged();
  } catch {
    throw new NpSiteBuildFinalArtifactPublicationErrorV1("conflict");
  }
  return {
    schemaVersion: "np.site-build-cli-result.v1" as const,
    operation: "handoff export" as const,
    status: publication.status,
    path: out,
    blueprintHash: envelope.handoff.bindings.blueprintHash,
    sourceTreeDigest: source.digest,
    verificationState: envelope.handoff.verification.state,
    observationScope: "recorded-artifact-bytes-only" as const,
    observedFiles: references.size,
    executedCommands: 0 as const,
    sourceWrites: 0 as const,
    authority: envelope.handoff.authority,
  };
}
