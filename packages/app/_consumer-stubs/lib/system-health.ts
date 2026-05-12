// Stub — see ./init-core.ts for the rationale.
export interface Check {
  id: string;
  label: string;
  state: "ok" | "warn" | "error";
  detail?: string;
  hint?: string;
}

export interface HealthSummary {
  generatedAt: string;
  checks: Check[];
  errorCount: number;
  warnCount: number;
}

export async function gatherSystemHealth(): Promise<HealthSummary> {
  return { generatedAt: "", checks: [], errorCount: 0, warnCount: 0 };
}
