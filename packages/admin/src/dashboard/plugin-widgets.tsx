"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

export interface DashboardPluginWidget {
  pluginId: string;
  pluginName: string;
  id: string;
  label: string;
  kind: "metric" | "status";
  actionId: string;
  description?: string;
}

interface DashboardPluginWidgetsProps {
  widgets: DashboardPluginWidget[];
}

type ActionResult = { ok: boolean; data?: unknown; error?: string };

async function dispatch(pluginId: string, actionId: string): Promise<ActionResult> {
  const response = await nxFetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "",
  });
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
  const body = (await response.json().catch(() => null)) as ActionResult | null;
  return body ?? { ok: false, error: "Empty response" };
}

export function DashboardPluginWidgets({ widgets }: DashboardPluginWidgetsProps) {
  if (widgets.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-[13px] font-semibold tracking-[-0.005em] text-neutral-950 dark:text-neutral-50">
        Plugin widgets
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((widget) => (
          <PluginWidgetCard key={`${widget.pluginId}:${widget.id}`} widget={widget} />
        ))}
      </div>
    </div>
  );
}

function PluginWidgetCard({ widget }: { widget: DashboardPluginWidget }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "metric"; value: string; delta?: string }
    | { kind: "status"; level: "ok" | "warn" | "error"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await dispatch(widget.pluginId, widget.actionId);
    if (!result.ok || !result.data) {
      setState({ kind: "error", message: result.error ?? "No data returned" });
      return;
    }
    const data = result.data as Record<string, unknown>;
    if (widget.kind === "metric") {
      setState({
        kind: "metric",
        value:
          typeof data.value === "string" || typeof data.value === "number"
            ? String(data.value)
            : "—",
        delta: typeof data.delta === "string" ? data.delta : undefined,
      });
    } else {
      const level =
        data.level === "ok" || data.level === "warn" || data.level === "error"
          ? data.level
          : "warn";
      setState({
        kind: "status",
        level,
        message: typeof data.message === "string" ? data.message : "",
      });
    }
  }, [widget]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {widget.label}
        </CardTitle>
        <p className="text-xs text-muted-foreground/80">{widget.pluginName}</p>
      </CardHeader>
      <CardContent>
        {state.kind === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : state.kind === "metric" ? (
          <div>
            <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-neutral-950 dark:text-neutral-50">{state.value}</div>
            {state.delta ? (
              <div className="text-xs text-muted-foreground">{state.delta}</div>
            ) : null}
          </div>
        ) : state.kind === "status" ? (
          <div className="flex items-center gap-2">
            {state.level === "ok" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            ) : state.level === "warn" ? (
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-300" />
            )}
            <span className="text-sm">{state.message}</span>
          </div>
        ) : (
          <div className="text-xs text-rose-600 dark:text-rose-300">{state.message}</div>
        )}
        {widget.description ? (
          <p className="mt-2 text-xs text-muted-foreground">{widget.description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
