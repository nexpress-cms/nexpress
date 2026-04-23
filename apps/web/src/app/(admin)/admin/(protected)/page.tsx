import { DashboardView } from "@nexpress/admin/client";
import { ensureCoreServices } from "@/lib/init-core";
import { loadDashboardStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  ensureCoreServices();

  const stats = await loadDashboardStats();

  return <DashboardView stats={stats} />;
}
