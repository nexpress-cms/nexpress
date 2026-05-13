import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getOptionalJobQueue,
  getPluginAdminExtension,
  getPluginConfigWithStatus,
  getPluginRegistration,
  introspectThemeSettingsSchema,
  verifyTokenFull,
  can,
  type NpPluginScheduleStats,
  type NpThemeSettingsField,
} from "@nexpress/core";
import { PluginAdminPage } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "../../../../lib/auth-helpers";
import { getDb } from "../../../../lib/db";
import { ensureFor } from "../../../../lib/init-core";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ pluginId: string }>;
}

export default async function PluginAdminRoute({ params }: PageProps) {
  await ensureFor("plugins");

  const token = (await cookies()).get("np-session")?.value;
  const { secret } = getAuthRuntimeConfig();
  const user = token ? await verifyTokenFull(token, secret, getDb()) : null;
  if (!user || !can(user, "admin.manage")) {
    notFound();
  }

  const { pluginId } = await params;
  const registration = getPluginRegistration(pluginId);
  const adminExt = getPluginAdminExtension(pluginId);

  // G.1 — a plugin that declares only `configSchema` (no
  // `admin.settings.fields`, no widgets/actions/tables) wouldn't
  // currently get an admin entry because `getPluginAdminExtension`
  // returns undefined. Allow the detail page to load whenever the
  // plugin is registered AND has either an admin extension or a
  // configSchema. The admin extension shape that gets passed down
  // can be the empty object in the configSchema-only case.
  if (!registration || (!adminExt && !registration.configSchema)) {
    notFound();
  }

  // Phase 4.2 — overlay queue history on top of the registry's static
  // schedule list. Pulled in the server component so the client gets
  // pre-rendered data on first paint and can re-fetch via the API on
  // demand (e.g. after a "Run now" click).
  const registeredSchedules = [...registration.schedules.values()];
  let scheduleStats = new Map<string, NpPluginScheduleStats>();
  if (registeredSchedules.length > 0) {
    const queue = getOptionalJobQueue();
    if (queue && typeof queue.getPluginScheduleStats === "function") {
      try {
        const stats = await queue.getPluginScheduleStats(pluginId);
        scheduleStats = new Map(stats.map((s) => [s.taskId, s] as const));
      } catch {
        // Queue not ready / pg-boss schema missing — fall through with
        // empty stats so the registered schedules still render.
      }
    }
  }
  const schedules = registeredSchedules
    .map((s) => {
      const stats = scheduleStats.get(s.taskId);
      return {
        taskId: s.taskId,
        cron: s.cron,
        description: s.description ?? null,
        lastRunAt: stats?.lastRunAt ?? null,
        lastSuccessAt: stats?.lastSuccessAt ?? null,
        lastFailureAt: stats?.lastFailureAt ?? null,
        completedCount: stats?.completedCount ?? 0,
        failedCount: stats?.failedCount ?? 0,
        windowDays: stats?.windowDays ?? 7,
      };
    })
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  // G.1 — read the persisted config every time, regardless of
  // whether the plugin declares a configSchema. Legacy plugins
  // (no schema, hand-rolled `admin.settings.fields`) still need
  // their saved values pre-populated in the SettingsCard form;
  // skipping this read for them would cause every operator to
  // see an empty form after the np_plugins.config → np_settings
  // migration, even though the data is intact.
  const configStatus = await getPluginConfigWithStatus(pluginId);
  const configValue =
    configStatus.value && typeof configStatus.value === "object"
      ? (configStatus.value as Record<string, unknown>)
      : {};

  // When configSchema is declared, introspect server-side (zod
  // lives in the plugin's server bundle; we don't ship it to the
  // browser) and pass the field metadata to the auto-form. The
  // auto-form mounts INSTEAD of any legacy admin.settings.fields
  // form, per the § 5.1.1 precedence rule.
  let configFields: NpThemeSettingsField[] | undefined;
  if (registration.configSchema) {
    configFields = introspectThemeSettingsSchema(
      registration.configSchema as Parameters<typeof introspectThemeSettingsSchema>[0],
    );
  }

  return (
    <PluginAdminPage
      pluginId={pluginId}
      pluginName={registration.name}
      admin={adminExt ?? {}}
      initialConfig={configValue}
      schedules={schedules}
      configFields={configFields}
      initialAutoConfig={configStatus.value}
      configParseError={configStatus.parseError}
    />
  );
}
