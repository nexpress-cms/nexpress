import { DashboardView } from "@nexpress/admin/client";
import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  ensureCoreServices();

  const stats = {
    collections: [] as Array<{ slug: string; label: string; count: number }>,
    recentActivity: [] as Array<{
      id: string;
      collection: string;
      title: string;
      action: string;
      timestamp: string;
    }>,
    draftCount: 0,
    mediaCount: 0,
  };

  return <DashboardView stats={stats} />;
}
