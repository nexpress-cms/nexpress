"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NpFieldConfig } from "@nexpress/core";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { useForm } from "react-hook-form";

import { FieldRenderer } from "../collections/field-renderer.js";
import { npFetch } from "../lib/api-client.js";
import { cn } from "../ui/utils.js";
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
import { Input } from "../ui/input.js";
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

/**
 * One-line summary string shown in the "Installed" card header.
 * Mirrors the design's `5 active · 1 update available` shape, but
 * we don't have an update-detection feed yet, so the string
 * surfaces the three states the API actually exposes:
 *
 *   active           → enabled && loaded
 *   pending restart  → enabled && !loaded
 *   disabled         → !enabled
 */
function summarizePluginCounts(items: PluginItem[]): string {
  let active = 0;
  let pending = 0;
  let disabled = 0;
  for (const p of items) {
    if (!p.enabled) disabled += 1;
    else if (!p.loaded) pending += 1;
    else active += 1;
  }
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} active`);
  if (pending > 0) parts.push(`${pending} pending restart`);
  if (disabled > 0) parts.push(`${disabled} disabled`);
  return parts.length > 0 ? parts.join(" · ") : `${items.length} installed`;
}

interface PluginRowProps {
  plugin: PluginItem;
  isFirst: boolean;
  togglingId: string | null;
  onToggle: (plugin: PluginItem, nextEnabled: boolean) => void | Promise<void>;
  onOpenConfig: (plugin: PluginItem) => void;
}

/**
 * Compact plugin row — design's `plugin-row` shape: name + slug
 * (`@nexpress/<id>@<version>`) + description on the left, status
 * pill in the middle, Configure / Open admin / Switch on the
 * right. Capabilities / Hooks / Routes hide behind a
 * "Show details" disclosure so the row stays compact for the
 * common "I just want to toggle a plugin" path.
 */
function PluginRow({ plugin, isFirst, togglingId, onToggle, onOpenConfig }: PluginRowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails =
    plugin.capabilities.length > 0 || plugin.hooks.length > 0 || plugin.routes.length > 0;

  const status: "active" | "pending" | "disabled" = !plugin.enabled
    ? "disabled"
    : plugin.loaded
      ? "active"
      : "pending";

  // Render the plugin's own id verbatim — the API hands back
  // the manifest id (e.g. `"reading-time"`), NOT the npm package
  // name. Fabricating an `@nexpress/` scope here would misrepresent
  // third-party plugins and even mis-spell first-party ones (their
  // npm names go through a `plugin-` prefix the manifest id
  // doesn't carry). Append the version when present.
  const slugLabel = plugin.version ? `${plugin.id}@${plugin.version}` : plugin.id;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-6 sm:py-4",
        !isFirst && "border-t border-border/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{plugin.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{slugLabel}</span>
        </div>
        {plugin.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{plugin.description}</p>
        ) : null}
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
        ) : null}
        {detailsOpen ? (
          <div className="mt-2 space-y-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
            {plugin.capabilities.length > 0 ? (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Capabilities
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {plugin.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="font-mono text-[10px]">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {plugin.hooks.length > 0 ? (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Hooks
                </span>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {plugin.hooks.join(", ")}
                </p>
              </div>
            ) : null}
            {plugin.routes.length > 0 ? (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Routes
                </span>
                <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  {plugin.routes.map((route) => (
                    <li key={`${route.method} ${route.path}`}>
                      <span className="font-semibold">{route.method}</span> /api/plugins/
                      {plugin.id}
                      {route.path}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <PluginStatusBadge status={status} />

      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        {plugin.hasAdmin ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/admin/plugins/${plugin.id}`}>
              <ExternalLink className="size-3.5" />
              Open admin
            </Link>
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenConfig(plugin)}>
          <Settings2 className="size-3.5" />
          Configure
        </Button>
        <Switch
          checked={plugin.enabled}
          disabled={togglingId !== null}
          onCheckedChange={(checked) => {
            void onToggle(plugin, checked);
          }}
          aria-label={`Toggle ${plugin.name}`}
        />
      </div>
    </div>
  );
}

function PluginStatusBadge({ status }: { status: "active" | "pending" | "disabled" }) {
  if (status === "active") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Active
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Pending restart
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Inactive
    </span>
  );
}

export function PluginsManager() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [toast, setToast] = useState<ToastState>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [configPlugin, setConfigPlugin] = useState<PluginItem | null>(null);
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [reloading, setReloading] = useState(false);
  // Browse-registry modal — Discover panel content lives in a
  // Dialog now instead of inline on the page (matches the design's
  // pagehead-action pattern).
  const [browseOpen, setBrowseOpen] = useState(false);
  // Install-plugin guide modal — explains the manual install flow
  // (npm install → add to nexpress.config.ts → restart). The
  // framework doesn't ship runtime install today, so this is the
  // honest UI for the "Install plugin" CTA.
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

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

  const reloadAllPlugins = async () => {
    setReloading(true);
    setToast(null);
    try {
      const response = await npFetch("/api/admin/plugins/reload", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as {
        reloaded?: boolean;
        schedules?: {
          added: number;
          updated: number;
          removed: number;
          workerOwnsRegistrations: boolean | null;
        } | null;
      } | null;
      if (!response.ok) {
        setToast({
          type: "error",
          message: getErrorMessage(payload, "Failed to reload plugins."),
        });
        return;
      }
      const lines: string[] = [
        "Re-registered every plugin.",
        "Code edits to plugin handlers still need a dev-server restart.",
      ];
      const sched = payload?.schedules ?? null;
      if (sched) {
        const total = sched.added + sched.updated + sched.removed;
        if (total > 0) {
          lines.push(
            `Schedules: +${sched.added} added, ${sched.updated} cron updated, -${sched.removed} removed.`,
          );
          // Issue #461 — when the web process *isn't* the worker (the
          // common production setup), `boss.work()` registrations live
          // in the worker process, which we can't poke from here. The
          // cron rows are updated, but a freshly-added schedule's job
          // won't be picked up until the worker restarts.
          if (sched.workerOwnsRegistrations === false && sched.added > 0) {
            lines.push(
              "Note: this process isn't the worker — restart your worker process to pick up newly-added schedules.",
            );
          }
        } else {
          lines.push("Schedules unchanged.");
        }
      }
      setToast({ type: "success", message: lines.join(" ") });
      await loadPlugins();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to reload plugins.",
      });
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Plugins"
          description="Toggle and configure installed plugins. Enable / disable applies to the next request; new plugins still need a server restart to register hooks and routes."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void reloadAllPlugins()}
            disabled={reloading}
            title="Reset the plugin registry and re-run setup() on every plugin"
          >
            {reloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Reload all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setBrowseOpen(true)}>
            <Globe className="size-3.5" />
            Browse registry
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setInstallGuideOpen(true)}
          >
            <Plus className="size-3.5" />
            Install plugin
          </Button>
        </div>
      </div>

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

      {state.kind === "ready" && state.items.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Installed</CardTitle>
              <span className="text-xs text-muted-foreground">
                {summarizePluginCounts(state.items)}
              </span>
            </div>
          </CardHeader>
          <div className="border-t border-border/60">
            {state.items.map((plugin, index) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                isFirst={index === 0}
                togglingId={togglingId}
                onToggle={handleToggle}
                onOpenConfig={openConfigDialog}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <BrowseRegistryDialog open={browseOpen} onOpenChange={setBrowseOpen} />
      <InstallGuideDialog open={installGuideOpen} onOpenChange={setInstallGuideOpen} />

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
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
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

// ────────────────────────────────────────────────────────────────────────
// Discover panel — npm registry search keyed on `nexpress-plugin`.
// Lazy: empty until the operator opens the panel + types a query (or
// hits "Browse all"). The endpoint forwards the call to
// `registry.npmjs.org/-/v1/search`; we only keep the curated subset of
// fields needed for the cards.
// ────────────────────────────────────────────────────────────────────────

interface DiscoveredPlugin {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  npmUrl: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  publishedAt: string | null;
  author: string | null;
}

interface BrowseRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Browse registry" — large modal listing every npm package
 * tagged `keywords:nexpress-plugin`. Replaces the inline
 * DiscoverPanel; the same `/api/admin/plugins/discover`
 * endpoint feeds the result list. Picks an initial empty
 * search the first time the modal opens so operators see a
 * full list before typing anything.
 */
function BrowseRegistryDialog({ open, onOpenChange }: BrowseRegistryDialogProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DiscoveredPlugin[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const response = await npFetch(`/api/admin/plugins/discover?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as {
        items?: DiscoveredPlugin[];
        error?: { message?: string } | string;
      } | null;
      if (!response.ok) {
        const message =
          (payload && typeof payload.error === "object" && payload.error?.message) ||
          (typeof payload?.error === "string" ? payload.error : null) ||
          "Failed to query the npm registry.";
        setError(message);
        return;
      }
      setItems(payload?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to query the npm registry.");
    } finally {
      setLoading(false);
    }
  }, []);

  // First open → kick off an empty search so the modal shows a
  // populated list before the operator types anything. We don't
  // re-fetch on every reopen; the result set is stable enough
  // that operators can refresh manually via the search button.
  useEffect(() => {
    if (open && items === null && !loading) {
      void search("");
    }
  }, [open, items, loading, search]);

  const copy = async (packageName: string) => {
    const command = `pnpm add ${packageName}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
        setCopied(packageName);
        setTimeout(() => setCopied(null), 2_000);
      }
    } catch {
      // Clipboard may be blocked (HTTP, browser policy). Fall through —
      // the install command is still visible inline on the card.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4" />
            Browse plugin registry
          </DialogTitle>
          <DialogDescription>
            Searches packages on the npm registry tagged with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              keywords:nexpress-plugin
            </code>
            . Copy the install command and run it from your project root, then add the plugin to{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">plugins</code> in{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              nexpress.config.ts
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <Input
            placeholder="Filter by name or keyword (e.g. seo, oauth, forum)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Search
          </Button>
        </form>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
          {!error && loading && items === null ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching the registry…
            </div>
          ) : null}
          {!error && items && items.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No matching plugins on the registry.
            </p>
          ) : null}
          {items && items.length > 0 ? (
            <div className="space-y-2">
              {items.map((plugin) => (
                <div
                  key={plugin.name}
                  className="rounded-xl border border-border/60 bg-card/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span>{plugin.name}</span>
                        {plugin.version ? (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            v{plugin.version}
                          </Badge>
                        ) : null}
                      </div>
                      {plugin.description ? (
                        <p className="text-xs text-muted-foreground">{plugin.description}</p>
                      ) : null}
                      <p className="font-mono text-[10px] text-muted-foreground">
                        pnpm add {plugin.name}
                      </p>
                      {plugin.author || plugin.publishedAt ? (
                        <p className="text-[11px] text-muted-foreground">
                          {plugin.author ? `by ${plugin.author}` : ""}
                          {plugin.author && plugin.publishedAt ? " · " : ""}
                          {plugin.publishedAt
                            ? `published ${new Date(plugin.publishedAt).toLocaleDateString()}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(plugin.name)}
                      >
                        <Copy className="size-3.5" />
                        {copied === plugin.name ? "Copied!" : "Copy install"}
                      </Button>
                      {plugin.npmUrl ? (
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={plugin.npmUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-3.5" />
                            npm
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface InstallGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Install plugin" — guide modal. NexPress doesn't ship a runtime
 * plugin installer (plugins are npm packages added to
 * `nexpress.config.ts`'s `plugins` array, then loaded at boot).
 * This modal walks the operator through that flow honestly:
 *
 *   1. Install via package manager
 *   2. Register in nexpress.config.ts
 *   3. Restart dev / redeploy
 *
 * The "Browse registry" CTA at the bottom routes to the registry
 * modal so an operator who clicked Install first lands in the
 * right place anyway.
 */
function InstallGuideDialog({ open, onOpenChange }: InstallGuideDialogProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2_000);
      }
    } catch {
      // Clipboard may be blocked. The snippet stays visible inline.
    }
  };

  // Reflect how plugins are actually wired in the reference app:
  // a static `definePlugin()` object passed directly into the
  // `plugins:` array. Per-plugin options live in the admin's
  // Configure dialog (handlers receive them via `ctx.config`),
  // NOT as a factory-call argument here.
  const configSnippet = `import { defineConfig } from "@nexpress/core";
import { yourPlugin } from "@nexpress/plugin-your-name";

export default defineConfig({
  plugins: [
    yourPlugin,
  ],
});`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            Install a plugin
          </DialogTitle>
          <DialogDescription>
            NexPress plugins are npm packages. There&apos;s no runtime install — the three steps
            below are the whole flow.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                1
              </span>
              <div className="font-medium">Install the package</div>
            </div>
            <div className="ml-7 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Run the install in your project root. Use <strong>Browse registry</strong> to find
                packages tagged{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  keywords:nexpress-plugin
                </code>
                .
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs">
                <span className="flex-1 select-all">pnpm add @nexpress/plugin-&lt;name&gt;</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy("pnpm add @nexpress/plugin-<name>", "install")}
                  aria-label="Copy install command"
                >
                  <Copy className="size-3.5" />
                  {copied === "install" ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          </li>

          <li className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                2
              </span>
              <div className="font-medium">
                Register the plugin in <code className="font-mono">nexpress.config.ts</code>
              </div>
            </div>
            <div className="ml-7 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Add it to the <code className="font-mono">plugins</code> array. Most plugins export
                a factory function — pass the options it expects.
              </p>
              <div className="rounded-lg border border-border/60 bg-muted/40">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="font-mono normal-case">nexpress.config.ts</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void copy(configSnippet, "config")}
                    aria-label="Copy config snippet"
                  >
                    <Copy className="size-3.5" />
                    {copied === "config" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
                  {configSnippet}
                </pre>
              </div>
            </div>
          </li>

          <li className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                3
              </span>
              <div className="font-medium">Restart and verify</div>
            </div>
            <div className="ml-7 space-y-1.5 text-xs text-muted-foreground">
              <p>
                Restart your dev server (or redeploy in production) so the bootstrap picks up the
                new plugin. The plugin will appear in the{" "}
                <strong className="font-medium text-foreground">Installed</strong> list above with
                status <em>Active</em> once its <code className="font-mono">setup()</code> runs
                cleanly.
              </p>
              <p>
                If a plugin you registered shows as <em>Pending restart</em>, the dev server
                hasn&apos;t reloaded yet — stop and restart{" "}
                <code className="font-mono">pnpm dev</code>.
              </p>
            </div>
          </li>
        </ol>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
