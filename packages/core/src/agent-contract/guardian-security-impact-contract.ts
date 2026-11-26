import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";

export interface NpAgentSecurityImpactV1 {
  scope: "site" | "deployment";
  affectedSiteCount: number;
  siteCatalogDigest: string;
}
export function npParseAgentSecurityImpactV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityImpactV1 {
  const keys = ["scope", "affectedSiteCount", "siteCatalogDigest"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const scope = canonicalBodyEnum<NpAgentSecurityImpactV1["scope"]>(
    row.scope,
    path,
    new Set(["site", "deployment"] as const),
  );
  const affectedSiteCount = canonicalBodyInteger(row.affectedSiteCount, path, 1, 10_000);
  if (scope === "site" && affectedSiteCount !== 1)
    failCanonicalBody("invalid-field", path, "site impact must identify one site");
  return {
    scope,
    affectedSiteCount,
    siteCatalogDigest: canonicalBodySha256Digest(row.siteCatalogDigest, path),
  };
}
