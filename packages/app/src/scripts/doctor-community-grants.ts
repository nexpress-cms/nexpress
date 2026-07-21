import { npIsCanonicalCollectionMainTableName } from "./doctor-collection-contract.js";

export interface CommunityGrantTarget {
  id: string;
  role: string;
  scopeType: "category" | "thread";
  scopeId: string;
  siteId: string;
}

export interface CommunityGrantTargetPlan {
  scopedTargets: CommunityGrantTarget[];
  issues: Array<{ path: string; message: string }>;
}

const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function npPlanCommunityRoleGrantTargets(
  grants: ReadonlyArray<Record<string, unknown>>,
  presentCollectionTables: ReadonlySet<string>,
): CommunityGrantTargetPlan {
  const scopedTargets: CommunityGrantTarget[] = [];
  const issues: Array<{ path: string; message: string }> = [];
  for (const row of grants) {
    if (
      (row.scopeType === "category" || row.scopeType === "thread") &&
      typeof row.id === "string" &&
      typeof row.role === "string" &&
      typeof row.scopeId === "string" &&
      typeof row.siteId === "string"
    ) {
      if (!CANONICAL_UUID_RE.test(row.scopeId)) {
        issues.push({
          path: `grants.${row.id}.scopeId`,
          message: `${row.role} must reference a canonical collection document id.`,
        });
      } else {
        scopedTargets.push({
          id: row.id,
          role: row.role,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          siteId: row.siteId,
        });
      }
    }
    if (row.scopeType === "collection" && typeof row.id === "string") {
      const scopeId = typeof row.scopeId === "string" ? row.scopeId : "";
      const tableName = `np_c_${scopeId}`;
      if (
        !npIsCanonicalCollectionMainTableName(tableName) ||
        !presentCollectionTables.has(tableName)
      ) {
        issues.push({
          path: `grants.${row.id}.scopeId`,
          message: `${typeof row.role === "string" ? row.role : "collection role"} references a missing collection.`,
        });
      }
    }
  }
  return { scopedTargets, issues };
}

export function npFindMissingCommunityRoleGrantTargets(
  targets: readonly CommunityGrantTarget[],
  foundScopedTargets: ReadonlySet<string>,
): Array<{ path: string; message: string }> {
  return targets.flatMap((grant) =>
    foundScopedTargets.has(`${grant.siteId}:${grant.scopeId}`)
      ? []
      : [
          {
            path: `grants.${grant.id}.scopeId`,
            message: `${grant.role} references a missing or cross-site ${grant.scopeType} target document.`,
          },
        ],
  );
}
