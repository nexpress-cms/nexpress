// Stub — see ./init-core.ts for the rationale.
import type { DashboardStats } from "@nexpress/admin";

export async function loadDashboardStats(): Promise<DashboardStats> {
  return {
    collections: [],
    recentActivity: [],
    draftCount: 0,
    mediaCount: 0,
  };
}
