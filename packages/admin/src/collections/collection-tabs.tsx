"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play } from "lucide-react";

import { nxFetch } from "../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

export interface CollectionTabWidget {
  id: string;
  label: string;
  kind: "metric" | "status";
  actionId: string;
  description?: string;
}

export interface CollectionTabAction {
  id: string;
  label: string;
  actionId: string;
  confirm?: string;
  description?: string;
}

export interface CollectionTabDescriptor {
  pluginId: string;
  pluginName: string;
  id: string;
  label: string;
  widgets?: CollectionTabWidget[];
  actions?: CollectionTabAction[];
  description?: string;
}

interface CollectionTabsProps {
  tabs: CollectionTabDescriptor[];
  collection: string;
  documentId: string;
}

type ActionResult = { ok: boolean; data?: unknown; error?: string };

async function dispatch(
  pluginId: string,
  actionId: string,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await nxFetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  const body = (await response.json().catch(() => null)) as ActionResult | null;
  return body ?? { ok: false, error: "Empty response" };
}

export function CollectionTabs({ tabs, collection, documentId }: CollectionTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <>
      {tabs.map((tab) => (
        <Card key={`${tab.pluginId}:${tab.id}`}>
          <CardHeader>
            <CardTitle className="text-base">{tab.label}</CardTitle>
            <p className="text-xs text-muted-foreground">{tab.pluginName}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {tab.description ? (
              <p className="text-xs text-muted-foreground">{tab.description}</p>
            ) : null}

            {tab.widgets && tab.widgets.length > 0 ? (
              <div className="space-y-3">
                {tab.widgets.map((widget) => (
                  <TabWidget
                    key={widget.id}
                    pluginId={tab.pluginId}
                    widget={widget}
                    collection={collection}
                    documentId={documentId}
                  />
                ))}
              </div>
            ) : null}

            {tab.actions && tab.actions.length > 0 ? (
              <div className="space-y-2">
                {tab.actions.map((action) => (
                  <TabAction
                    key={action.id}
                    pluginId={tab.pluginId}
                    action={action}
                    collection={collection}
                    documentId={documentId}
                  />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function TabWidget({
  pluginId,
  widget,
  collection,
  documentId,
}: {
  pluginId: string;
  widget: CollectionTabWidget;
  collection: string;
  documentId: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "metric"; value: string; delta?: string }
    | { kind: "status"; level: "ok" | "warn" | "error"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await dispatch(pluginId, widget.actionId, { collection, documentId });
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
  }, [pluginId, widget, collection, documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs font-medium text-muted-foreground">{widget.label}</div>
      <div className="mt-1">
        {state.kind === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : state.kind === "metric" ? (
          <div>
            <div className="text-xl font-semibold">{state.value}</div>
            {state.delta ? (
              <div className="text-xs text-muted-foreground">{state.delta}</div>
            ) : null}
          </div>
        ) : state.kind === "status" ? (
          <div className="flex items-center gap-2">
            {state.level === "ok" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            ) : state.level === "warn" ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-300" />
            )}
            <span className="text-sm">{state.message}</span>
          </div>
        ) : (
          <div className="text-xs text-rose-600 dark:text-rose-300">{state.message}</div>
        )}
      </div>
      {widget.description ? (
        <p className="mt-2 text-xs text-muted-foreground">{widget.description}</p>
      ) : null}
    </div>
  );
}

function TabAction({
  pluginId,
  action,
  collection,
  documentId,
}: {
  pluginId: string;
  action: CollectionTabAction;
  collection: string;
  documentId: string;
}) {
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const run = useCallback(async () => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setRunning(true);
    setToast(null);
    const result = await dispatch(pluginId, action.actionId, { collection, documentId });
    setRunning(false);
    if (!result.ok) {
      setToast({ type: "error", message: result.error ?? "Action failed." });
      return;
    }
    setToast({
      type: "success",
      message: typeof result.data === "string" ? result.data : `${action.label}: done.`,
    });
  }, [pluginId, action, collection, documentId]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div>
        <div className="text-sm font-medium">{action.label}</div>
        {action.description ? (
          <div className="text-xs text-muted-foreground">{action.description}</div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void run()}
        disabled={running}
      >
        {running ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <Play className="mr-2 h-3 w-3" />
        )}
        Run
      </Button>
      {toast ? (
        <div
          className={
            toast.type === "success"
              ? "text-xs text-emerald-700 dark:text-emerald-200"
              : "text-xs text-rose-700 dark:text-rose-200"
          }
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
