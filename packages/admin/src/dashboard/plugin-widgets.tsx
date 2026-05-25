"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { npFetch } from "../lib/api-client.js";
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
  const response = await npFetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
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
    <div className="min-w-0">
      <h2 className="mb-3 break-words text-[13px] font-semibold tracking-[-0.005em] text-neutral-950 dark:text-neutral-50">
        Plugin widgets
      </h2>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    <Card className="min-w-0">
      <CardHeader className="border-b-0 pb-0">
        <CardTitle className="break-words text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          {widget.label}
        </CardTitle>
        <p className="break-all font-mono text-[11px] text-neutral-400">{widget.pluginName}</p>
      </CardHeader>
      <CardContent className="min-w-0">
        {state.kind === "loading" ? (
          <Loader2 className="size-4 animate-spin text-neutral-400" />
        ) : state.kind === "metric" ? (
          <div className="min-w-0">
            <div className="break-words text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-neutral-950 dark:text-neutral-50">
              {state.value}
            </div>
            {state.delta ? (
              <div className="mt-0.5 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
                {state.delta}
              </div>
            ) : null}
          </div>
        ) : state.kind === "status" ? (
          <div className="flex min-w-0 items-center gap-2">
            {state.level === "ok" ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            ) : state.level === "warn" ? (
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-red-600" />
            )}
            <span className="min-w-0 break-words text-[13px]">{state.message}</span>
          </div>
        ) : (
          <div className="break-words text-[12px] text-red-600 dark:text-red-300">
            {state.message}
          </div>
        )}
        {widget.description ? (
          <p className="mt-2 break-words text-[11.5px] text-neutral-500 dark:text-neutral-400">
            {widget.description}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
