import { npAnalyzeCollectionSystemRow } from "@nexpress/core/collection-contract";
import { npIsCommunityDocumentAudience } from "@nexpress/core/community-contract";

export function npFindDoctorCollectionRowIssues(
  row: Record<string, unknown>,
  path: string,
  hasAudience: boolean,
): Array<{ path: string; message: string }> {
  // Audience belongs to the community contract; the generic envelope stays exact.
  const { audience, ...systemRow } = row;
  const result = npAnalyzeCollectionSystemRow(hasAudience ? systemRow : row, path);
  const issues: Array<{ path: string; message: string }> = [...result.issues];
  if (hasAudience && !npIsCommunityDocumentAudience(audience)) {
    issues.push({ path: `${path}.audience`, message: "must be public, members, or private." });
  }
  return issues;
}

export function npIsCollectionMainTableName(tableName: string): boolean {
  return tableName.startsWith("np_c_") && !tableName.includes("__");
}

export function npIsCanonicalCollectionMainTableName(tableName: string): boolean {
  return /^np_c_[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(tableName);
}
