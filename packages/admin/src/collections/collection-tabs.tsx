"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play } from "lucide-react";

import { npDispatchPluginAction } from "../lib/plugin-action-results.js";
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

export function CollectionTabs({ tabs, collection, documentId }: CollectionTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <>
      {tabs.map((tab) => (
        <Card key={`${tab.pluginId}:${tab.id}`} className="min-w-0" data-np-collection-tab-panel>
          <CardHeader>
            <CardTitle className="break-words text-base">{tab.label}</CardTitle>
            <p className="break-words text-xs text-muted-foreground">{tab.pluginName}</p>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            {tab.description ? (
              <p className="break-words text-xs text-muted-foreground">{tab.description}</p>
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
    if (widget.kind === "metric") {
      const result = await npDispatchPluginAction(pluginId, widget.actionId, "metric", {
        collection,
        documentId,
      });
      if (!result.ok) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setState({
        kind: "metric",
        value: String(result.data.value),
        delta: result.data.delta,
      });
    } else {
      const result = await npDispatchPluginAction(pluginId, widget.actionId, "status", {
        collection,
        documentId,
      });
      if (!result.ok) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setState({
        kind: "status",
        level: result.data.level,
        message: result.data.message,
      });
    }
  }, [pluginId, widget, collection, documentId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  return (
    <div className="min-w-0 rounded-lg border border-border/60 p-3">
      <div className="break-words text-xs font-medium text-muted-foreground">{widget.label}</div>
      <div className="mt-1">
        {state.kind === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : state.kind === "metric" ? (
          <div className="min-w-0">
            <div className="break-words text-xl font-semibold">{state.value}</div>
            {state.delta ? (
              <div className="break-words text-xs text-muted-foreground">{state.delta}</div>
            ) : null}
          </div>
        ) : state.kind === "status" ? (
          <div className="flex min-w-0 items-start gap-2">
            {state.level === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            ) : state.level === "warn" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
            )}
            <span className="min-w-0 break-words text-sm">{state.message}</span>
          </div>
        ) : (
          <div className="break-words text-xs text-rose-600 dark:text-rose-300">
            {state.message}
          </div>
        )}
      </div>
      {widget.description ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">{widget.description}</p>
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
    const result = await npDispatchPluginAction(pluginId, action.actionId, "action", {
      collection,
      documentId,
    });
    setRunning(false);
    if (!result.ok) {
      setToast({ type: "error", message: result.error });
      return;
    }
    setToast({
      type: "success",
      message: typeof result.data === "string" ? result.data : `${action.label}: done.`,
    });
  }, [pluginId, action, collection, documentId]);

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="min-w-0">
        <div className="break-words text-sm font-medium">{action.label}</div>
        {action.description ? (
          <div className="break-words text-xs text-muted-foreground">{action.description}</div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
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
              ? "break-words text-xs text-emerald-700 dark:text-emerald-200"
              : "break-words text-xs text-rose-700 dark:text-rose-200"
          }
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
