import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import {
  compareUtf8,
  npBuildSourceExcludedDirectoryNamesV1,
  npBuildSourceExcludedRootsV1,
  relativePath,
  text,
  unique,
} from "./primitives.js";
import {
  buildPackageContentDigest,
  buildPackageName,
  buildPackageVersion,
} from "./package-content.js";

/** Policy identifiers, not shell commands or model-selected package scripts. */
export const npBuildCommandPoliciesV1 = Object.freeze(
  [
    { template: "format", mutation: "declared-source" },
    { template: "schema-generate", mutation: "declared-source" },
    { template: "migration-generate", mutation: "declared-source" },
    { template: "typecheck", mutation: "temporary-output" },
    { template: "lint", mutation: "temporary-output" },
    { template: "build", mutation: "temporary-output" },
    { template: "test", mutation: "temporary-output" },
    { template: "doctor", mutation: "temporary-output" },
    { template: "preview-render", mutation: "declared-review" },
    { template: "verify", mutation: "temporary-output" },
  ].map((policy) => Object.freeze(policy)),
);

export interface NpAgentBuildCommandRegistryV1 {
  schemaVersion: "np.agent-build-command-registry.v1";
  implementation: "np.site-build.v1";
  node: { version: string; platform: "darwin" | "linux"; arch: "arm64" | "x64"; sha256: string };
  /** Observed installed files used by the fixed implementation. No absolute host paths. */
  entrypoints: Array<{
    package: string;
    version: string;
    contentDigest: string;
    path: string;
    sha256: string;
  }>;
  policies: Array<{ template: string; mutation: string }>;
  sourceExclusions: { roots: string[]; directoryNames: string[] };
  shell: false;
  packageScripts: false;
  inheritedEnvironment: false;
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const schema: z.ZodType<NpAgentBuildCommandRegistryV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-command-registry.v1"),
    implementation: z.literal("np.site-build.v1"),
    node: z.strictObject({
      version: text(128).regex(/^v\d+\.\d+\.\d+$/u),
      platform: z.enum(["darwin", "linux"]),
      arch: z.enum(["arm64", "x64"]),
      sha256,
    }),
    entrypoints: unique(
      z.strictObject({
        package: buildPackageName,
        version: buildPackageVersion,
        contentDigest: buildPackageContentDigest,
        path: relativePath,
        sha256,
      }),
      100,
      (entry) => `${entry.package}\0${entry.path}`,
    ).min(1),
    policies: z.array(z.strictObject({ template: text(32), mutation: text(32) })).length(10),
    sourceExclusions: z.strictObject({
      roots: z.array(relativePath).length(npBuildSourceExcludedRootsV1.length),
      directoryNames: z.array(text(32)).length(npBuildSourceExcludedDirectoryNamesV1.length),
    }),
    shell: z.literal(false),
    packageScripts: z.literal(false),
    inheritedEnvironment: z.literal(false),
  })
  .superRefine((value, ctx) => {
    if (
      JSON.stringify(value.policies) !== JSON.stringify(npBuildCommandPoliciesV1) ||
      JSON.stringify(value.sourceExclusions.roots) !==
        JSON.stringify(npBuildSourceExcludedRootsV1) ||
      JSON.stringify(value.sourceExclusions.directoryNames) !==
        JSON.stringify(npBuildSourceExcludedDirectoryNamesV1)
    )
      ctx.addIssue({
        code: "custom",
        message: "must use the exact fixed command policy and exclusions",
      });
    if (
      value.entrypoints.some((entry, i) => {
        if (i === 0) return false;
        const previous = value.entrypoints[i - 1];
        return (
          (compareUtf8(previous.package, entry.package) ||
            compareUtf8(previous.path, entry.path)) >= 0
        );
      }) ||
      !value.entrypoints.some(
        (entry) => entry.package === "@nexpress/cli" && entry.path === "dist/index.js",
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "entrypoints require the owning CLI and UTF-8 order",
      });
  });

/** A descriptor cannot prove installed executable identity or authorize execution. */
export function npRequireAgentBuildCommandRegistryV1(
  value: unknown,
): NpAgentBuildCommandRegistryV1 {
  return requireArtifact(value, schema, { bytes: 128 * 1024, depth: 5 });
}
