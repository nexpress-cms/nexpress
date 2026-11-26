import { npAnalyzeBlockContent, npApplyPatternOverridesV1 } from "@nexpress/blocks";
import { npMergeThemeTokens } from "@nexpress/core/theme";
import {
  npBuildCanonicalBytes,
  npBuildDirectionProjectionV1,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  npRequireBuildDirectionSetForBriefV1,
  type NpAgentBuildInstalledCatalogV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentDesignDirectionSetV1,
} from "@nexpress/core/agent-contract";
import {
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";

interface NpConfiguredBuildDirectionSetV1<Set> {
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  set: Set;
}

const compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

function fail(message: string): never {
  throw new Error(`Invalid installed Build proposal: ${message}`);
}

/**
 * Resolve a proposal against freshly loaded installed declarations. The host must
 * isolate loading and freshly observe the source capsule. This does not render,
 * authenticate preview files/receipts, initialize services, or grant execution.
 */
export async function npValidateConfiguredBuildDirectionSetV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
  briefValue: unknown,
  setValue: unknown,
  kind: "draft",
): Promise<NpConfiguredBuildDirectionSetV1<NpAgentDesignDirectionDraftSetV1>>;
export async function npValidateConfiguredBuildDirectionSetV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
  briefValue: unknown,
  setValue: unknown,
  kind: "sealed",
): Promise<NpConfiguredBuildDirectionSetV1<NpAgentDesignDirectionSetV1>>;
export async function npValidateConfiguredBuildDirectionSetV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
  briefValue: unknown,
  setValue: unknown,
  kind: "draft" | "sealed",
) {
  if (kind !== "draft" && kind !== "sealed") fail("unknown proposal kind");
  const set =
    kind === "draft"
      ? await npRequireBuildDirectionSetForBriefV1(briefValue, setValue, "draft")
      : await npRequireBuildDirectionSetForBriefV1(briefValue, setValue, "sealed");
  const { catalog, fingerprint, themes } = await npResolveConfiguredBuildCatalogV1(
    configValue,
    sourceCapsuleValue,
    ownerBindings,
  );
  const inputs = set.comparisonInputs.projectionInputs;
  if (
    set.discoveryFingerprint !== fingerprint ||
    inputs.discoveryFingerprint !== fingerprint ||
    set.directions.some((direction) => direction.discoveryFingerprint !== fingerprint)
  ) {
    fail("catalog fingerprint must match freshly observed installed declarations");
  }
  const byPackage = new Map(themes.map((theme) => [theme.package, theme]));
  const declaredThemes = inputs.themeBaseIds.map((packageName) => {
    const theme = byPackage.get(packageName);
    if (!theme) fail("declared theme package is not installed");
    return theme;
  });
  const patterns = new Set(declaredThemes.flatMap((theme) => theme.patterns.map(({ id }) => id)));
  const templates = new Set(declaredThemes.flatMap((theme) => theme.templates.map(({ id }) => id)));
  if (inputs.patternIds.some((id) => !patterns.has(id))) {
    fail("declared pattern does not belong to an installed declared theme");
  }
  if (inputs.templateIds.some((id) => !templates.has(id))) {
    fail("declared template does not belong to an installed declared theme");
  }
  const expectedDefinitions = [
    ...new Set(
      (await npBuildInstalledBlockDefinitionFingerprintsV1(catalog))
        .filter((definition) => inputs.themeBaseIds.includes(definition.themePackage))
        .map((definition) => definition.fingerprint),
    ),
  ].sort(compare);
  if (
    inputs.blockDefinitionFingerprints.length !== expectedDefinitions.length ||
    inputs.blockDefinitionFingerprints.some((entry, index) => entry !== expectedDefinitions[index])
  ) {
    fail("block definition fingerprints must bind the complete installed declared-theme inventory");
  }
  for (const page of set.comparisonInputs.informationArchitecture) {
    if (page.locale !== null && !catalog.locales.includes(page.locale)) {
      fail("comparison locale is not configured in the installed project");
    }
  }
  for (const direction of set.directions) {
    const theme = byPackage.get(direction.themeBase);
    if (!theme) fail("direction theme package is not installed");
    // Layout is owned by the selected normal theme/templates. There is no
    // framework-wide density, width or navigation setter. Do not seal an
    // override that the ordinary application would silently ignore.
    if (
      direction.layout.density !== "theme-native" ||
      direction.layout.contentWidth !== "theme-native" ||
      direction.layout.navigation !== "theme-native"
    )
      fail("layout overrides require an installed presentation owner; use theme-native");
    const tokens = npMergeThemeTokens(theme.tokens, direction.tokens);
    if (
      direction.typography.heading !== tokens.typography.fontHeading ||
      direction.typography.body !== tokens.typography.fontBody ||
      (direction.typography.mono !== null &&
        direction.typography.mono !== tokens.typography.fontMono)
    )
      fail("typography must match the actual merged theme tokens");
    const projection = npBuildDirectionProjectionV1(direction);
    const resolved = {
      ...projection,
      pageBindings: projection.pageBindings.map((binding) => {
        if (binding.source === "custom") {
          if (!theme.templates.some((template) => template.id === binding.templateId)) {
            fail("custom page template is unavailable for its selected theme");
          }
          if (npAnalyzeBlockContent(binding.blocks, theme.definitions).length > 0) {
            fail("custom blocks must satisfy the exact selected installed definitions");
          }
          return binding;
        }
        const pattern = theme.patterns.find((candidate) => candidate.id === binding.patternId);
        if (!pattern) fail("page pattern is unavailable for its selected theme");
        return {
          ...binding,
          blocks: npApplyPatternOverridesV1(pattern.blocks, binding.overrides, theme.definitions),
        };
      }),
    };
    const before = npBuildCanonicalBytes(
      "np.build-design-direction-projection.v1",
      projection,
    ).canonicalJsonUtf8;
    const after = npBuildCanonicalBytes(
      "np.build-design-direction-projection.v1",
      resolved,
    ).canonicalJsonUtf8;
    if (!Buffer.from(before).equals(Buffer.from(after))) {
      fail("persisted blocks must equal their exact materialized installed pattern overrides");
    }
  }
  return { catalog, fingerprint, set };
}
