import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import {
  compareUtf8,
  encoder,
  inspectJson,
  relativePath,
  serializeJson,
  text,
  under,
  unique,
} from "./primitives.js";
import { collisionFree } from "./schemas.js";

export interface NpBuildInstalledPackageContentV1 {
  schemaVersion: "np.installed-package-content.v1";
  name: string;
  version: string;
  files: Array<{ path: string; mode: "100644" | "100755"; sha256: string }>;
}
export const buildPackageName = text(214).regex(
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u,
);
export const buildPackageVersion = text(128).regex(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
);
export const buildPackageContentDigest = z
  .string()
  .regex(/^npkg1:sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const packagePath = relativePath.refine(
  (value) => under("package").safeParse(`package/${value}`).success,
  "package content cannot address credentials",
);
const packageSchema: z.ZodType<NpBuildInstalledPackageContentV1> = z
  .strictObject({
    schemaVersion: z.literal("np.installed-package-content.v1"),
    name: buildPackageName,
    version: buildPackageVersion,
    files: unique(
      z.strictObject({
        path: packagePath,
        mode: z.enum(["100644", "100755"]),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      10_000,
      (file) => file.path,
    ).min(1),
  })
  .superRefine((value, ctx) => {
    if (
      !collisionFree(value.files.map((file) => file.path)) ||
      value.files.some(
        (file, i) => i > 0 && compareUtf8(value.files[i - 1].path, file.path) >= 0,
      ) ||
      !value.files.some((file) => file.path === "package.json")
    )
      ctx.addIssue({
        code: "custom",
        message: "package files must contain package.json and be collision-free in UTF-8 order",
      });
  });
const packageLimits = { bytes: 4 * 1024 * 1024, depth: 4 };

export function npRequireBuildInstalledPackageContentV1(
  value: unknown,
): NpBuildInstalledPackageContentV1 {
  return requireArtifact(value, packageSchema, packageLimits);
}

/** Local installed-file inventory identity, distinct from registry tarball SRI and Build's closed purposes. */
export async function npBuildInstalledPackageContentDigestV1(
  value: unknown,
): Promise<`npkg1:sha256:${string}`> {
  const body = npRequireBuildInstalledPackageContentV1(value);
  const json = serializeJson(inspectJson(body, packageLimits.bytes, packageLimits.depth));
  const bytes = encoder.encode(`np.installed-package-content.v1\0${json}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `npkg1:sha256:${btoa(String.fromCharCode(...hash))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")}`;
}
