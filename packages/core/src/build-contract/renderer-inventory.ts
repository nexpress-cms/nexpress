import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import { sourceTreeSchema } from "./schemas.js";
import { compareUtf8, unique } from "./primitives.js";
import {
  buildPackageContentDigest,
  buildPackageName,
  buildPackageVersion,
} from "./package-content.js";
import type { NpAgentBuildSourceTreeV1 } from "./types.js";

export interface NpAgentBuildDirectionRendererV1 {
  schemaVersion: "np.agent-build-direction-renderer.v1";
  implementation: "np.site-build.v1";
  projectSources: NpAgentBuildSourceTreeV1;
  packages: Array<{ name: string; version: string; contentDigest: string }>;
}
const packageKey = (value: NpAgentBuildDirectionRendererV1["packages"][number]) =>
  `${value.name}@${value.version}:${value.contentDigest}`;
const schema: z.ZodType<NpAgentBuildDirectionRendererV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-direction-renderer.v1"),
    implementation: z.literal("np.site-build.v1"),
    projectSources: sourceTreeSchema,
    packages: unique(
      z.strictObject({
        name: buildPackageName,
        version: buildPackageVersion,
        contentDigest: buildPackageContentDigest,
      }),
      2000,
      packageKey,
    ).min(1),
  })
  .superRefine((value, ctx) => {
    if (
      value.packages.some((item, i) => {
        if (i === 0) return false;
        const prior = value.packages[i - 1];
        return (
          (compareUtf8(prior.name, item.name) ||
            compareUtf8(prior.version, item.version) ||
            compareUtf8(prior.contentDigest, item.contentDigest)) >= 0
        );
      })
    )
      ctx.addIssue({ code: "custom", message: "package instances must be in UTF-8 order" });
    for (const required of [
      "@nexpress/app",
      "@nexpress/blocks",
      "@nexpress/cli",
      "@nexpress/core",
      "@nexpress/theme",
      "react",
      "react-dom",
    ]) {
      if (!value.packages.some((item) => item.name === required))
        ctx.addIssue({ code: "custom", message: "missing owning renderer package" });
    }
  });
export function npRequireAgentBuildDirectionRendererV1(
  value: unknown,
): NpAgentBuildDirectionRendererV1 {
  return requireArtifact(value, schema, { bytes: 4 * 1024 * 1024, depth: 6 });
}
