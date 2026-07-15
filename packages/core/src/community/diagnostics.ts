import { npCommunityContractLimits } from "../community-contract/contract.js";
import type { NpCommunityRuntimeDiagnostic } from "../community-contract/types.js";

const diagnostics: NpCommunityRuntimeDiagnostic[] = [];

export function npRecordCommunityRuntimeDiagnostic(
  source: NpCommunityRuntimeDiagnostic["source"],
  message: string,
): void {
  diagnostics.push({
    source,
    message: message.slice(0, 500),
    occurredAt: new Date().toISOString(),
  });
  if (diagnostics.length > npCommunityContractLimits.diagnostics) {
    diagnostics.splice(0, diagnostics.length - npCommunityContractLimits.diagnostics);
  }
}

export function getCommunityRuntimeDiagnostics(): NpCommunityRuntimeDiagnostic[] {
  return diagnostics.map((entry) => ({ ...entry }));
}

export function resetCommunityRuntimeDiagnostics(): void {
  diagnostics.length = 0;
}
