import { DashboardView } from "@nexpress/admin/client";
import type { DashboardPluginWidget } from "@nexpress/admin";
import { getDashboardWidgetsFromPlugins } from "@nexpress/core";
import { ensureFor } from "@/lib/init-core";
import { loadDashboardStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await ensureFor("plugins");

  const stats = await loadDashboardStats();
  const pluginWidgets: DashboardPluginWidget[] = getDashboardWidgetsFromPlugins().map(
    (widget) => ({
      pluginId: widget.pluginId,
      pluginName: widget.pluginName,
      id: widget.id,
      label: widget.label,
      kind: widget.kind,
      actionId: widget.actionId,
      description: widget.description,
    }),
  );

  return <DashboardView stats={stats} pluginWidgets={pluginWidgets} />;
}
