import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import { compareUtf8, digest, locale, relativePath, text, unique } from "./primitives.js";
import { collisionFree, viewports } from "./schemas.js";
import type { NpAgentPreviewViewportV1 } from "./types.js";

interface RenderEnvironmentCommon {
  schemaVersion: "np.agent-build-render-environment.v1";
  implementation: "np.site-build.v1";
  commandRegistryFingerprint: string;
  browser: { engine: "chromium"; version: string; sha256: string };
  fonts: Array<{ path: string; sha256: string }>;
  locales: string[];
  timezone: "UTC";
  colorScheme: "light";
  reducedMotion: "reduce";
  viewports: { desktop: NpAgentPreviewViewportV1; mobile: NpAgentPreviewViewportV1 };
  clock: { now: string; randomSeed: string };
  imageCanonicalizer: "np.png-rgba.v1";
}
/** Observed identities, not caller assertions that these isolation controls ran. */
export interface NpAgentBuildLinuxRenderEnvironmentV1 {
  architecture: "arm64" | "x64";
  kernel: { release: string; version: string };
  imageId: string;
  imageRecipeSha256: string;
  supervisor: { binarySha256: string; sourceSha256: string };
  node: { version: string; sha256: string };
  postgres: { version: string; sha256: string };
  fontconfigSha256: string;
  runtimeFilesSha256: string;
  cacheProfile: "np.site-build-next-cache.v1";
  requestPolicy: { implementation: "np.site-build-browser-requests.v1"; sha256: string };
  driverFiles: Array<{ path: string; sha256: string }>;
}
export type NpAgentBuildRenderEnvironmentV1 = RenderEnvironmentCommon &
  (
    | { sandbox: "np.seatbelt.v1" }
    | { sandbox: "np.linux-build-sandbox.v1"; linux: NpAgentBuildLinuxRenderEnvironmentV1 }
  );

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const common = {
  schemaVersion: z.literal("np.agent-build-render-environment.v1"),
  implementation: z.literal("np.site-build.v1"),
  commandRegistryFingerprint: digest,
  browser: z.strictObject({
    engine: z.literal("chromium"),
    version: text(128).regex(/^\d+\.\d+\.\d+\.\d+$/u),
    sha256,
  }),
  fonts: unique(z.strictObject({ path: relativePath, sha256 }), 100, (font) => font.path).min(1),
  locales: unique(locale, 20).min(1),
  timezone: z.literal("UTC"),
  colorScheme: z.literal("light"),
  reducedMotion: z.literal("reduce"),
  viewports,
  clock: z.strictObject({
    now: z.iso.datetime({ precision: 3 }),
    randomSeed: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  imageCanonicalizer: z.literal("np.png-rgba.v1"),
};
const linux = z.strictObject({
  architecture: z.enum(["arm64", "x64"]),
  kernel: z.strictObject({ release: text(128), version: text(256) }),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  imageRecipeSha256: sha256,
  supervisor: z.strictObject({ binarySha256: sha256, sourceSha256: sha256 }),
  node: z.strictObject({ version: text(128).regex(/^v\d+\.\d+\.\d+$/u), sha256 }),
  postgres: z.strictObject({ version: text(256), sha256 }),
  fontconfigSha256: sha256,
  runtimeFilesSha256: sha256,
  cacheProfile: z.literal("np.site-build-next-cache.v1"),
  requestPolicy: z.strictObject({
    implementation: z.literal("np.site-build-browser-requests.v1"),
    sha256,
  }),
  driverFiles: unique(z.strictObject({ path: relativePath, sha256 }), 100, (file) => file.path).min(
    1,
  ),
});
const schema: z.ZodType<NpAgentBuildRenderEnvironmentV1> = z
  .discriminatedUnion("sandbox", [
    z.strictObject({ ...common, sandbox: z.literal("np.seatbelt.v1") }),
    z.strictObject({ ...common, sandbox: z.literal("np.linux-build-sandbox.v1"), linux }),
  ])
  .superRefine((value, ctx) => {
    if (!collisionFree(value.fonts.map((font) => font.path)))
      ctx.addIssue({ code: "custom", message: "font paths must be collision-free" });
    for (const values of [value.fonts.map((font) => font.path), value.locales])
      if (values.some((entry, i) => i > 0 && compareUtf8(values[i - 1], entry) >= 0))
        ctx.addIssue({
          code: "custom",
          message: "font and locale identities must be in UTF-8 order",
        });
    if (value.sandbox === "np.linux-build-sandbox.v1") {
      const paths = value.linux.driverFiles.map((file) => file.path);
      if (
        !collisionFree(paths) ||
        paths.some((path, i) => i > 0 && compareUtf8(paths[i - 1], path) >= 0)
      )
        ctx.addIssue({ code: "custom", message: "driver identities must be in UTF-8 order" });
    }
  });

/** Structure only; the renderer must observe every executable/font and enforce the sandbox. */
export function npRequireAgentBuildRenderEnvironmentV1(
  value: unknown,
): NpAgentBuildRenderEnvironmentV1 {
  return requireArtifact(value, schema, { bytes: 64 * 1024, depth: 5 });
}
