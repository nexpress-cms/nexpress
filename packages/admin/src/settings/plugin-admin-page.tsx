"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NpFieldConfig, NpThemeSettingsField } from "@nexpress/core";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Play } from "lucide-react";

import { FieldRenderer } from "../collections/field-renderer.js";
import { npFetch } from "../lib/api-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Form } from "../ui/form.js";
import { ZodForm, type ZodFormValue } from "../zod-form/index.js";
import { PageHeader } from "../layout/page-header.js";
import { useForm } from "react-hook-form";

interface ScheduleDef {
  taskId: string;
  cron: string;
  description: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  completedCount: number;
  failedCount: number;
  windowDays: number;
}

interface ColumnDef {
  name: string;
  label: string;
}

interface WidgetDef {
  id: string;
  label: string;
  kind: "metric" | "status";
  actionId: string;
  description?: string;
}

interface ActionDef {
  id: string;
  label: string;
  actionId: string;
  confirm?: string;
  description?: string;
}

interface TableDef {
  id: string;
  label: string;
  columns: ColumnDef[];
  rowsActionId: string;
  emptyMessage?: string;
}

interface AdminExtension {
  settings?: {
    title?: string;
    description?: string;
    fields: NpFieldConfig[];
  };
  widgets?: WidgetDef[];
  actions?: ActionDef[];
  tables?: TableDef[];
}

interface PluginAdminPageProps {
  pluginId: string;
  pluginName: string;
  admin: AdminExtension;
  initialConfig: Record<string, unknown>;
  /** Phase 4.2 — registered cron tasks + execution history. Empty when the
   *  plugin doesn't declare scheduled tasks; absent when the queue isn't
   *  wired (e.g. dev without pg-boss). */
  schedules?: ScheduleDef[];
  /** G.1 — introspected metadata from the plugin's `configSchema`.
   *  When non-empty, an auto-form replaces the legacy
   *  `admin.settings.fields` form (per design doc § 5.1.1
   *  precedence). Server-side introspection happens in the route
   *  loader; client just renders. */
  configFields?: NpThemeSettingsField[];
  /** G.1 — initial value for the auto-form. Comes from
   *  `getPluginConfig(pluginId)` (versioned envelope unwrapped,
   *  schema defaults filled in for unsaved fields). Distinct from
   *  `initialConfig` (legacy `np_plugins.config` style) although
   *  both currently mirror each other. */
  initialAutoConfig?: unknown;
  /** G.1 — set when the persisted config failed `safeParse`
   *  (buggy migrator, schema drift the migrator didn't cover).
   *  The auto-form receives schema defaults as `initialAutoConfig`;
   *  this prop drives a warning banner so the operator knows their
   *  saved values were replaced and the next save will overwrite. */
  configParseError?: string;
}

type ActionResult = { ok: boolean; data?: unknown; error?: string };

async function dispatch(
  pluginId: string,
  actionId: string,
  payload?: unknown,
): Promise<ActionResult> {
  const response = await npFetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? "" : JSON.stringify(payload),
  });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  const body = (await response.json().catch(() => null)) as ActionResult | null;
  return body ?? { ok: false, error: "Empty response" };
}

export function PluginAdminPage({
  pluginId,
  pluginName,
  admin,
  initialConfig,
  schedules,
  configFields,
  initialAutoConfig,
  configParseError,
}: PluginAdminPageProps) {
  const hasAutoForm = (configFields?.length ?? 0) > 0;
  const sections: Array<"autoForm" | "settings" | "widgets" | "actions" | "tables" | "schedules"> =
    [];
  if (hasAutoForm) sections.push("autoForm");
  // G.1 § 5.1.1 — auto-form wins; the legacy admin.settings.fields
  // form is hidden when configSchema is also declared. Host-side
  // console.warn already names both sources for the operator.
  if (admin.settings && !hasAutoForm) sections.push("settings");
  if (admin.widgets?.length) sections.push("widgets");
  if (admin.actions?.length) sections.push("actions");
  if (admin.tables?.length) sections.push("tables");
  if (schedules?.length) sections.push("schedules");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={pluginName}
        description="Plugin admin surface. Settings save to the plugin's DB config; widgets and actions dispatch the plugin's registered handlers."
      />

      {admin.widgets && admin.widgets.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {admin.widgets.map((widget) => (
            <WidgetCard key={widget.id} pluginId={pluginId} widget={widget} />
          ))}
        </div>
      ) : null}

      {hasAutoForm ? (
        <ConfigAutoFormCard
          pluginId={pluginId}
          fields={configFields!}
          initialValue={
            initialAutoConfig && typeof initialAutoConfig === "object"
              ? (initialAutoConfig as ZodFormValue)
              : {}
          }
          parseError={configParseError}
        />
      ) : admin.settings ? (
        <SettingsCard pluginId={pluginId} settings={admin.settings} initialConfig={initialConfig} />
      ) : null}

      {admin.actions && admin.actions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {admin.actions.map((action) => (
              <ActionRow key={action.id} pluginId={pluginId} action={action} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {admin.tables?.map((table) => (
        <TableCard key={table.id} pluginId={pluginId} table={table} />
      ))}

      {schedules && schedules.length > 0 ? (
        <SchedulesCard pluginId={pluginId} schedules={schedules} />
      ) : null}

      {sections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            This plugin doesn&rsquo;t declare any admin extensions.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function ConfigAutoFormCard({
  pluginId,
  fields,
  initialValue,
  parseError,
}: {
  pluginId: string;
  fields: NpThemeSettingsField[];
  initialValue: ZodFormValue;
  parseError?: string;
}) {
  const [value, setValue] = useState<ZodFormValue>(initialValue);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // Once the operator dismisses the banner (or saves over the
  // schema-default values), the parse-error condition is
  // resolved on the server; we hide the banner client-side too
  // so a successful save doesn't leave it stuck.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showBanner = !bannerDismissed && Boolean(parseError);

  const handleSubmit = useCallback(async () => {
    setSaving(true);
    setToast(null);
    try {
      const response = await npFetch(`/api/admin/plugins/${pluginId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setToast({
          type: "error",
          message: payload?.error?.message ?? "Failed to save config.",
        });
        return;
      }
      setToast({ type: "success", message: "Config saved." });
      // The save persisted a fresh value over the schema-defaults
      // shown after the parse error; the banner is no longer
      // accurate (the next page load won't surface parseError),
      // so dismiss it client-side too.
      setBannerDismissed(true);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save config.",
      });
    } finally {
      setSaving(false);
    }
  }, [pluginId, value]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        {showBanner ? (
          <div className="mb-4 grid gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 sm:flex sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">Saved settings were reset to defaults</div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                The persisted value didn&rsquo;t match the current schema (likely a plugin upgrade).
                Saving will overwrite the stored value with what you see below.
              </p>
              {parseError ? (
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-amber-500/10 p-2 text-[11px] leading-snug">
                  {parseError}
                </pre>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setBannerDismissed(true)}
              className="w-full sm:w-auto"
            >
              Dismiss
            </Button>
          </div>
        ) : null}
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-200"
                : "mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}
        <ZodForm fields={fields} initialValue={initialValue} onChange={setValue} />
        <div className="mt-4 grid sm:flex sm:justify-end">
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void handleSubmit();
            }}
            className="w-full sm:w-auto"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({
  pluginId,
  settings,
  initialConfig,
}: {
  pluginId: string;
  settings: NonNullable<AdminExtension["settings"]>;
  initialConfig: Record<string, unknown>;
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
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    setToast(null);
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
        setToast({ type: "error", message: payload?.error?.message ?? "Failed to save settings." });
        return;
      }
      setToast({ type: "success", message: "Settings saved." });
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save settings.",
      });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{settings.title ?? "Settings"}</CardTitle>
      </CardHeader>
      <CardContent>
        {settings.description ? (
          <p className="mb-4 text-sm text-muted-foreground">{settings.description}</p>
        ) : null}
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-200"
                : "mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}
        <Form {...form}>
          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            className="space-y-4"
          >
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
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save settings
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function WidgetCard({ pluginId, widget }: { pluginId: string; widget: WidgetDef }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "metric"; value: string; delta?: string }
    | { kind: "status"; level: "ok" | "warn" | "error"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await dispatch(pluginId, widget.actionId);
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
  }, [pluginId, widget]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="border-b-0 pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{widget.label}</CardTitle>
      </CardHeader>
      <CardContent>
        {state.kind === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : state.kind === "metric" ? (
          <div>
            <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-neutral-950 dark:text-neutral-50">
              {state.value}
            </div>
            {state.delta ? (
              <div className="text-xs text-muted-foreground">{state.delta}</div>
            ) : null}
          </div>
        ) : state.kind === "status" ? (
          <div className="flex min-w-0 items-center gap-2">
            {state.level === "ok" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            ) : state.level === "warn" ? (
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-300" />
            )}
            <span className="min-w-0 break-words text-sm">{state.message}</span>
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

function ActionRow({ pluginId, action }: { pluginId: string; action: ActionDef }) {
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const run = useCallback(async () => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setRunning(true);
    setToast(null);
    const result = await dispatch(pluginId, action.actionId);
    setRunning(false);
    if (!result.ok) {
      setToast({ type: "error", message: result.error ?? "Action failed." });
      return;
    }
    setToast({
      type: "success",
      message: typeof result.data === "string" ? result.data : `${action.label}: done.`,
    });
  }, [pluginId, action]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="break-words text-sm font-medium">{action.label}</div>
        {action.description ? (
          <div className="break-words text-xs text-muted-foreground">{action.description}</div>
        ) : null}
        {toast ? (
          <div
            className={
              toast.type === "success"
                ? "mt-2 break-words text-xs text-emerald-700 dark:text-emerald-200"
                : "mt-2 break-words text-xs text-rose-700 dark:text-rose-200"
            }
          >
            {toast.message}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => void run()}
        disabled={running}
        className="w-full sm:w-auto"
      >
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Run
      </Button>
    </div>
  );
}

function TableCard({ pluginId, table }: { pluginId: string; table: TableDef }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        rows: Array<Record<string, unknown> & { id?: string }>;
        total: number;
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await dispatch(pluginId, table.rowsActionId);
    if (!result.ok || !result.data) {
      setState({ kind: "error", message: result.error ?? "No data" });
      return;
    }
    const data = result.data as { rows?: unknown; total?: unknown };
    const rows = Array.isArray(data.rows) ? (data.rows as Array<Record<string, unknown>>) : [];
    const total = typeof data.total === "number" ? data.total : rows.length;
    setState({ kind: "ready", rows, total });
  }, [pluginId, table]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="grid gap-2 space-y-0 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="min-w-0 break-words">{table.label}</CardTitle>
        {state.kind === "ready" ? <Badge variant="secondary">{state.total}</Badge> : null}
      </CardHeader>
      <CardContent>
        {state.kind === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : state.kind === "error" ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">{state.message}</p>
        ) : state.rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{table.emptyMessage ?? "No rows."}</p>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {state.rows.map((row, index) => (
                <dl
                  key={String(row.id ?? index)}
                  className="space-y-2 rounded-xl border border-border/60 bg-background/70 p-3 text-sm"
                >
                  {table.columns.map((col) => (
                    <div
                      key={col.name}
                      className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] gap-3"
                    >
                      <dt className="min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {col.label}
                      </dt>
                      <dd className="min-w-0 break-words text-right text-foreground">
                        {renderCell(row[col.name])}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200/70 dark:border-neutral-800/70">
                    {table.columns.map((col) => (
                      <th
                        key={col.name}
                        className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row, index) => (
                    <tr key={String(row.id ?? index)} className="border-b last:border-b-0">
                      {table.columns.map((col) => (
                        <td key={col.name} className="max-w-[24rem] px-3 py-2 align-top">
                          <span className="break-words">{renderCell(row[col.name])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SchedulesCard({ pluginId, schedules }: { pluginId: string; schedules: ScheduleDef[] }) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const runNow = useCallback(
    async (taskId: string) => {
      setBusyTaskId(taskId);
      setToast(null);
      try {
        const response = await npFetch(`/api/plugins/${pluginId}/schedules/${taskId}/run`, {
          method: "POST",
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setToast({
            type: "error",
            message: payload?.error?.message ?? "Failed to enqueue task.",
          });
          return;
        }
        setToast({
          type: "success",
          message: `Enqueued "${taskId}". Watch /admin/jobs for progress.`,
        });
      } catch (error) {
        setToast({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to enqueue task.",
        });
      } finally {
        setBusyTaskId(null);
      }
    },
    [pluginId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4" />
          Scheduled tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
        {schedules.map((schedule) => (
          <div
            key={schedule.taskId}
            className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="grid gap-2 text-sm font-medium sm:flex sm:items-center">
                <span className="min-w-0 break-all">{schedule.taskId}</span>
                <Badge
                  variant="secondary"
                  className="w-fit max-w-full break-all font-mono text-[10px]"
                >
                  {schedule.cron}
                </Badge>
              </div>
              {schedule.description ? (
                <div className="break-words text-xs text-muted-foreground">
                  {schedule.description}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <ScheduleStat label="Last run" value={formatTimestamp(schedule.lastRunAt)} />
                <ScheduleStat
                  label="Last success"
                  value={formatTimestamp(schedule.lastSuccessAt)}
                />
                <ScheduleStat
                  label={`Successes (${schedule.windowDays}d)`}
                  value={schedule.completedCount.toString()}
                />
                <ScheduleStat
                  label={`Failures (${schedule.windowDays}d)`}
                  value={schedule.failedCount.toString()}
                  highlight={schedule.failedCount > 0 ? "warn" : undefined}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runNow(schedule.taskId)}
              disabled={busyTaskId !== null}
              className="w-full sm:w-auto"
            >
              {busyTaskId === schedule.taskId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run now
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ScheduleStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "warn";
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.08em]">{label}</div>
      <div
        className={
          highlight === "warn"
            ? "break-words text-rose-600 dark:text-rose-300"
            : "break-words text-foreground/80"
        }
      >
        {value}
      </div>
    </div>
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Cyclic refs / non-serializable values fall through to a placeholder
    // rather than `String(symbol)` which would throw.
    return "[unserializable]";
  }
}
