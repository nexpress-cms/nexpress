"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NpFieldConfig } from "@nexpress/core";
import { ExternalLink, Loader2, Settings2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { FieldRenderer } from "../collections/field-renderer.js";
import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Form } from "../ui/form.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import { PageHeader } from "../layout/page-header.js";

interface PluginAdminSettings {
  title?: string;
  description?: string;
  fields: NpFieldConfig[];
}

interface PluginItem {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  capabilities: string[];
  hooks: string[];
  routes: Array<{ method: string; path: string }>;
  hasAdmin?: boolean;
  /**
   * When the plugin declares `admin.settings.fields`, the dialog renders a
   * typed form via `FieldRenderer` instead of the JSON textarea fallback.
   * Null means "no schema" — the textarea is the only honest UI then.
   */
  adminSettings?: PluginAdminSettings | null;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: string;
  updatedAt: string;
  loaded: boolean;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "ready"; items: PluginItem[] }
  | { kind: "error"; message: string };

type ToastState = { type: "success" | "error"; message: string } | null;

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && payload !== null && "error" in payload) {
    const err = (payload as { error?: unknown }).error;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string") return msg;
    }
  }
  return fallback;
}

export function PluginsManager() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [toast, setToast] = useState<ToastState>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [configPlugin, setConfigPlugin] = useState<PluginItem | null>(null);
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const loadPlugins = useCallback(async () => {
    try {
      const response = await npFetch("/api/plugins");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setState({ kind: "error", message: getErrorMessage(payload, "Unable to load plugins.") });
        return;
      }
      const items =
        payload && typeof payload === "object" && "items" in payload
          ? ((payload as { items: PluginItem[] }).items ?? [])
          : [];
      setState({ kind: "ready", items });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to load plugins.",
      });
    }
  }, []);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleToggle = async (plugin: PluginItem, nextEnabled: boolean) => {
    setTogglingId(plugin.id);
    setToast(null);

    try {
      const response = await npFetch(`/api/plugins/${plugin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setToast({ type: "error", message: getErrorMessage(payload, "Failed to update plugin.") });
        return;
      }

      setToast({
        type: "success",
        message: nextEnabled
          ? `Enabled ${plugin.name}. Hooks, routes, and scheduled tasks resume immediately.`
          : `Disabled ${plugin.name}. Hooks, routes, and scheduled tasks pause immediately.`,
      });
      await loadPlugins();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update plugin.",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const openConfigDialog = (plugin: PluginItem) => {
    setConfigPlugin(plugin);
    setConfigText(JSON.stringify(plugin.config ?? {}, null, 2));
    setConfigError(null);
  };

  const saveConfig = async () => {
    if (!configPlugin) return;
    setSavingConfig(true);
    setConfigError(null);

    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(configText) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Config must be a JSON object.");
      }
      parsed = raw as Record<string, unknown>;
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Invalid JSON.");
      setSavingConfig(false);
      return;
    }

    try {
      const response = await npFetch(`/api/plugins/${configPlugin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setConfigError(getErrorMessage(payload, "Failed to save config."));
        return;
      }
      setToast({ type: "success", message: `Updated ${configPlugin.name} config.` });
      setConfigPlugin(null);
      await loadPlugins();
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Failed to save config.");
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plugins"
        description="Toggle and configure installed plugins. Enable / disable applies to the next request; new plugins still need a server restart to register hooks and routes."
      />

      {toast ? (
        <div
          className={
            toast.type === "success"
              ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-200"
              : "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-200"
          }
        >
          {toast.message}
        </div>
      ) : null}

      {state.kind === "loading" ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading plugins…
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {state.message}
        </div>
      ) : null}

      {state.kind === "ready" && state.items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No plugins installed. Add plugins to <code>plugins</code> in{" "}
            <code>nexpress.config.ts</code> and restart.
          </CardContent>
        </Card>
      ) : null}

      {state.kind === "ready" && state.items.length > 0
        ? state.items.map((plugin) => (
            <Card key={plugin.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    {plugin.name}
                    {plugin.version ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        v{plugin.version}
                      </span>
                    ) : null}
                    {plugin.enabled && !plugin.loaded ? (
                      <Badge
                        variant="secondary"
                        className="bg-amber-500/15 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        pending restart
                      </Badge>
                    ) : null}
                    {!plugin.enabled ? (
                      <Badge variant="secondary">disabled</Badge>
                    ) : null}
                  </CardTitle>
                  {plugin.description ? (
                    <p className="text-sm text-muted-foreground">{plugin.description}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    <code>{plugin.id}</code>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {plugin.hasAdmin ? (
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link href={`/admin/plugins/${plugin.id}`}>
                        <ExternalLink className="size-3.5" />
                        Open admin
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openConfigDialog(plugin)}
                  >
                    <Settings2 className="size-3.5" />
                    Config
                  </Button>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`enabled-${plugin.id}`} className="text-xs text-muted-foreground">
                      {plugin.enabled ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      id={`enabled-${plugin.id}`}
                      checked={plugin.enabled}
                      disabled={togglingId !== null}
                      onCheckedChange={(checked) => {
                        void handleToggle(plugin, checked);
                      }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {plugin.capabilities.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Capabilities
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {plugin.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="font-mono text-xs">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {plugin.hooks.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Hooks
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {plugin.hooks.join(", ")}
                    </p>
                  </div>
                ) : null}
                {plugin.routes.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Routes
                    </p>
                    <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                      {plugin.routes.map((route) => (
                        <li key={`${route.method} ${route.path}`}>
                          <span className="font-semibold">{route.method}</span>{" "}
                          /api/plugins/{plugin.id}
                          {route.path}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        : null}

      <Dialog
        open={configPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setConfigPlugin(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{configPlugin ? `${configPlugin.name} config` : "Config"}</DialogTitle>
            <DialogDescription>
              {configPlugin?.adminSettings
                ? "Edit the plugin's settings. Changes apply immediately to new requests; already-loaded handlers see the new config on their next call."
                : "Edit the plugin's JSON config. Changes apply immediately to new requests, but already-loaded plugin code may need a restart."}
            </DialogDescription>
          </DialogHeader>
          {configPlugin?.adminSettings ? (
            <PluginConfigForm
              key={configPlugin.id}
              pluginId={configPlugin.id}
              settings={configPlugin.adminSettings}
              initialConfig={configPlugin.config}
              onSaved={() => {
                setToast({
                  type: "success",
                  message: `Updated ${configPlugin.name} config.`,
                });
                setConfigPlugin(null);
                void loadPlugins();
              }}
              onCancel={() => setConfigPlugin(null)}
            />
          ) : (
            <>
              <Textarea
                value={configText}
                onChange={(event) => setConfigText(event.target.value)}
                rows={14}
                className="font-mono text-xs"
                spellCheck={false}
              />
              {configError ? (
                <p className="text-sm text-rose-600 dark:text-rose-300">{configError}</p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfigPlugin(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void saveConfig();
                  }}
                  disabled={savingConfig}
                >
                  {savingConfig ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Save config
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Renders a typed config form for a plugin that declared `admin.settings.fields`.
 * Mirrors the `SettingsCard` in `plugin-admin-page.tsx` but trimmed for use
 * inside the inline dialog — the dedicated `/admin/plugins/[id]` page is still
 * the place for widgets / actions / tables; this just lets users tweak
 * config-only plugins from the list view.
 */
function PluginConfigForm({
  pluginId,
  settings,
  initialConfig,
  onSaved,
  onCancel,
}: {
  pluginId: string;
  settings: PluginAdminSettings;
  initialConfig: Record<string, unknown>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const defaultValues = useMemo(() => {
    const result: Record<string, unknown> = { ...initialConfig };
    for (const field of settings.fields) {
      if (field.type === "row" || field.type === "collapsible") continue;
      if (result[field.name] === undefined && field.defaultValue !== undefined) {
        result[field.name] = field.defaultValue;
      }
    }
    return result;
  }, [settings.fields, initialConfig]);

  const form = useForm<Record<string, unknown>>({ defaultValues });
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await npFetch(`/api/plugins/${pluginId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: values }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setErrorMessage(payload?.error?.message ?? "Failed to save settings.");
        return;
      }
      onSaved();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        className="space-y-4"
      >
        {settings.description ? (
          <p className="text-sm text-muted-foreground">{settings.description}</p>
        ) : null}
        {settings.fields.map((field, index) => (
          <FieldRenderer
            key={
              field.type === "row" || field.type === "collapsible"
                ? `${field.type}-${index}`
                : field.name
            }
            field={field}
            control={form.control}
          />
        ))}
        {errorMessage ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save config
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
