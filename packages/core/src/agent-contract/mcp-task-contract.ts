export const npAgentMcpTaskLimitsV1 = Object.freeze({
  ttlMinMs: 60_000,
  ttlDefaultMs: 3_600_000,
  ttlMaxMs: 86_400_000,
  pollIntervalMinMs: 1_000,
  pollIntervalDefaultMs: 2_000,
  pollIntervalMaxMs: 10_000,
  activePerAuthorizationContext: 32,
  activePerSite: 1_000,
  operationsPerAuthorizationContextPerMinute: 120,
} as const);

export const npAgentMcpTaskStatusesV1 = ["working", "completed", "failed", "cancelled"] as const;
export type NpAgentMcpTaskStatusV1 = (typeof npAgentMcpTaskStatusesV1)[number];

export const npAgentMcpTaskStatusMessagesV1 = Object.freeze({
  working: "Operation in progress",
  completed: "Operation completed",
  failed: "Operation failed",
  cancelled: "Operation cancelled",
} as const satisfies Record<NpAgentMcpTaskStatusV1, string>);

export const npAgentMcpTaskIdPatternV1 =
  /^npt1_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface NpAgentMcpTaskV1 {
  taskId: string;
  status: NpAgentMcpTaskStatusV1;
  statusMessage: (typeof npAgentMcpTaskStatusMessagesV1)[NpAgentMcpTaskStatusV1];
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval: number;
}

export function npRequireAgentMcpTaskIdV1(value: unknown): string {
  if (typeof value !== "string" || !npAgentMcpTaskIdPatternV1.test(value)) {
    throw new Error("Invalid Agent MCP task id.");
  }
  return value;
}

export function npRequireAgentMcpTaskTtlV1(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < npAgentMcpTaskLimitsV1.ttlMinMs ||
    (value as number) > npAgentMcpTaskLimitsV1.ttlMaxMs
  ) {
    throw new Error("Invalid Agent MCP task TTL.");
  }
  return value as number;
}
