import { z } from "zod";
import {
  npRequireBlockDiscoveryResponse,
  npRequirePluginDiscoveryResponse,
} from "../discovery-contract/contract.js";
import type { NpBlockDiscoveryItem, NpPluginDiscoveryItem } from "../discovery-contract/types.js";
import type { NpBlockContent } from "../fields/block-content.js";
import { npValidateBlockContent } from "../fields/block-content.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";
import { requireArtifact } from "./artifact.js";
import { npBuildCanonicalDigest } from "./contract.js";
import {
  npRequireAgentBuildCollectionDefinitionV1,
  type NpAgentBuildCollectionDefinitionV1,
} from "./collection-definition.js";
import {
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
} from "./renderer-inventory.js";
import { buildPackageName, buildPackageVersion } from "./package-content.js";
import {
  compareUtf8,
  encoder,
  fail,
  id,
  inspectJson,
  parseBuildJsonWithLimits,
  serializeJson,
  sortedIds,
  text,
  unique,
} from "./primitives.js";

export interface NpAgentBuildInstalledThemeV1 {
  id: string;
  package: string;
  version: string;
  tokens: NpThemeTokensOverlay;
  templates: Array<{ id: string; collection: string }>;
  navigationLocations: string[];
  blocks: NpBlockDiscoveryItem[];
  patterns: Array<{ id: string; blocks: NpBlockContent }>;
}
export interface NpAgentBuildInstalledCatalogV1 {
  schemaVersion: "np.agent-build-installed-catalog.v1";
  observation: "configured-declarations";
  sourceCapsule: NpAgentBuildDirectionRendererV1;
  collections: NpAgentBuildCollectionDefinitionV1[];
  themes: NpAgentBuildInstalledThemeV1[];
  plugins: Array<{ package: string; version: string; declaration: NpPluginDiscoveryItem }>;
  locales: string[];
  defaultLocale: string | null;
}

/** Raw transport retains duplicate-key rejection at this owner's fixed depth/byte bounds. */
export function npParseBuildInstalledCatalogJsonV1(raw: string): NpAgentBuildInstalledCatalogV1 {
  return npRequireAgentBuildInstalledCatalogV1(parseBuildJsonWithLimits(raw, 4 * 1024 * 1024, 20));
}
const schema: z.ZodType<NpAgentBuildInstalledCatalogV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-installed-catalog.v1"),
    observation: z.literal("configured-declarations"),
    sourceCapsule: z.custom<NpAgentBuildDirectionRendererV1>((value) => {
      try {
        npRequireAgentBuildDirectionRendererV1(value);
        return true;
      } catch {
        return false;
      }
    }),
    collections: unique(
      z.custom<NpAgentBuildCollectionDefinitionV1>((value) => {
        try {
          npRequireAgentBuildCollectionDefinitionV1(value);
          return true;
        } catch {
          return false;
        }
      }),
      64,
      (value) => (typeof value.configuration.slug === "string" ? value.configuration.slug : ""),
    ),
    themes: unique(
      z.strictObject({
        id,
        package: buildPackageName,
        version: buildPackageVersion,
        tokens: z.custom<NpThemeTokensOverlay>(
          (value) => npAnalyzeThemeTokensOverlay(value).length === 0,
        ),
        templates: unique(z.strictObject({ id, collection: text(63) }), 200, (value) => value.id),
        navigationLocations: sortedIds(32),
        blocks: z.custom<NpBlockDiscoveryItem[]>((value) => {
          try {
            npRequireBlockDiscoveryResponse({ items: value });
            return true;
          } catch {
            return false;
          }
        }),
        patterns: unique(
          z.strictObject({
            id,
            blocks: z.custom<NpBlockContent>((value) => npValidateBlockContent(value).ok),
          }),
          1000,
          (value) => value.id,
        ),
      }),
      64,
      (value) => value.package,
    ).min(1),
    plugins: unique(
      z.strictObject({
        package: buildPackageName,
        version: buildPackageVersion,
        declaration: z.custom<NpPluginDiscoveryItem>((value) => {
          try {
            npRequirePluginDiscoveryResponse({ items: [value] });
            return true;
          } catch {
            return false;
          }
        }),
      }),
      64,
      (value) => value.package,
    ),
    locales: unique(
      text(35).refine((value) => {
        try {
          return Intl.getCanonicalLocales(value)[0] === value;
        } catch {
          return false;
        }
      }),
      20,
    ),
    defaultLocale: text(35).nullable(),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (value.defaultLocale !== null && !value.locales.includes(value.defaultLocale))
      issue("default locale must belong to locale inventory");
    if (value.locales.length !== 0 && value.defaultLocale === null)
      issue("localized projects require a default locale");
    if (new Set(value.themes.map((theme) => theme.id)).size !== value.themes.length)
      issue("theme ids must be unique");
    for (const item of [...value.themes, ...value.plugins]) {
      if (
        !value.sourceCapsule.packages.some(
          (pkg) => pkg.name === item.package && pkg.version === item.version,
        )
      )
        issue("component owner must belong to the observed package capsule");
    }
    for (const theme of value.themes) {
      if (
        theme.templates.some(
          (entry, index) => index > 0 && compareUtf8(theme.templates[index - 1].id, entry.id) >= 0,
        ) ||
        theme.patterns.some(
          (entry, index) => index > 0 && compareUtf8(theme.patterns[index - 1].id, entry.id) >= 0,
        ) ||
        theme.blocks.some(
          (entry, index) => index > 0 && compareUtf8(theme.blocks[index - 1].type, entry.type) >= 0,
        )
      )
        issue("theme inventories must be in UTF-8 order");
    }
  });
export function npRequireAgentBuildInstalledCatalogV1(
  value: unknown,
): NpAgentBuildInstalledCatalogV1 {
  return requireArtifact(value, schema, { bytes: 4 * 1024 * 1024, depth: 20 });
}
/** Owning discovery digest, not a second Build-purpose wrapper, signature or proof of activation. */
export async function npBuildInstalledCatalogBytesV1(
  value: unknown,
): Promise<{ canonicalJsonUtf8: Uint8Array; hashInputUtf8: Uint8Array }> {
  const body = npRequireAgentBuildInstalledCatalogV1(value);
  const capsuleDigest = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    body.sourceCapsule,
  );
  for (const collection of body.collections) {
    if (collection.callbacks.length && collection.sourceCapsuleDigest !== capsuleDigest)
      fail(
        "build.catalog.collection.source",
        "callback slots must bind this exact observed source capsule",
      );
  }
  const canonical = serializeJson(inspectJson(body, 4 * 1024 * 1024, 20));
  return {
    canonicalJsonUtf8: encoder.encode(canonical),
    hashInputUtf8: encoder.encode(`np.installed-build-catalog.v1\0${canonical}`),
  };
}
export async function npBuildInstalledCatalogDigestV1(
  value: unknown,
): Promise<`ndc1:sha256:${string}`> {
  const { hashInputUtf8 } = await npBuildInstalledCatalogBytesV1(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(hashInputUtf8)));
  return `ndc1:sha256:${btoa(String.fromCharCode(...hash))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")}`;
}

export interface NpBuildInstalledBlockDefinitionFingerprintV1 {
  themePackage: string;
  blockType: string;
  fingerprint: `nbdef1:sha256:${string}`;
}

/**
 * A subordinate installed-discovery profile, not a new Build canonical purpose.
 * The catalog identity binds source/package bytes; actual props still require
 * validation against the live definition, never just its discovery projection.
 */
export async function npBuildInstalledBlockDefinitionFingerprintsV1(
  value: unknown,
): Promise<NpBuildInstalledBlockDefinitionFingerprintV1[]> {
  const catalog = npRequireAgentBuildInstalledCatalogV1(value);
  const catalogFingerprint = await npBuildInstalledCatalogDigestV1(catalog);
  const output: NpBuildInstalledBlockDefinitionFingerprintV1[] = [];
  for (const theme of catalog.themes) {
    for (const definition of theme.blocks) {
      const body = {
        schemaVersion: "np.installed-build-block-definition.v1",
        catalogFingerprint,
        themePackage: theme.package,
        definition,
      };
      const canonical = serializeJson(inspectJson(body, 4 * 1024 * 1024, 16));
      const bytes = encoder.encode(`np.installed-build-block-definition.v1\0${canonical}`);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      output.push({
        themePackage: theme.package,
        blockType: definition.type,
        fingerprint: `nbdef1:sha256:${btoa(String.fromCharCode(...hash))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/u, "")}`,
      });
    }
  }
  return output;
}
export function npRequireBuildCatalogPackageV1(
  catalog: NpAgentBuildInstalledCatalogV1,
  name: string,
  version: string,
) {
  const instances = catalog.sourceCapsule.packages.filter(
    (item) => item.name === name && item.version === version,
  );
  if (instances.length !== 1)
    fail("build.catalog.package", "requires one exact installed package instance");
  return instances[0];
}
