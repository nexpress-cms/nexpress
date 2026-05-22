import { z } from "zod";

import { npPluginAgentCategories, npPluginCapabilities } from "./types.js";

const npPluginVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/);

/**
 * Version of the manifest schema itself — NOT the plugin's own version.
 * Bumps when the manifest shape changes in a backwards-incompatible way;
 * older plugins can continue to target older apiVersion values while a newer
 * host negotiates compatibility. The value is a literal so host code can
 * switch on it without stringly-typed parsing.
 */
export const NP_PLUGIN_MANIFEST_API_VERSION = "1" as const;

export const npPluginManifestSchema = z.object({
  apiVersion: z.literal("1").default("1"),
  id: z.string().regex(/^(@[\w-]+\/)?[\w-]+$/),
  version: npPluginVersionSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.object({
    name: z.string(),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
  license: z.string(),
  nexpress: z.object({
    minVersion: npPluginVersionSchema,
    maxVersion: npPluginVersionSchema.optional(),
  }),
  // Defaults to an empty array so block-only / declarative-only plugins
  // (no hooks, no routes) don't have to type out `capabilities: []`. The
  // host enforces capability gates at registration time, so omitting this
  // is the most-restrictive option, not the most-permissive.
  capabilities: z.array(z.enum(npPluginCapabilities)).default([]),
  allowedHosts: z.array(z.string()).default([]),
  /**
   * IDs of other plugins this one depends on. The host loads them in
   * topological order so this plugin's `setup()` can assume the listed
   * plugins have already registered their hooks, actions, and blocks.
   *
   * A missing dependency or a cycle causes the dependent plugin to be
   * skipped at boot (logged via the host's logger). Non-fatal — the
   * remaining plugins still load.
   */
  requires: z.array(z.string()).default([]),
  provides: z
    .object({
      blocks: z.array(z.string()).default([]),
      fields: z.array(z.string()).default([]),
      collections: z.array(z.string()).default([]),
      adminExtensions: z.array(z.string()).default([]),
      apiRoutes: z.array(z.string()).default([]),
      pageRoutes: z.array(z.string()).default([]),
      scheduledTasks: z.array(z.string()).default([]),
      hooks: z.array(z.string()).default([]),
    })
    .default({
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      pageRoutes: [],
      scheduledTasks: [],
      hooks: [],
    }),
  // The agent block exists for AI assistants / catalog generators that
  // want a richer summary than the plain `description`. Defaults to an
  // empty descriptor so plugins that don't care don't have to fabricate
  // a category — the catalog falls back to the manifest's top-level
  // `description` when `agent.description` is empty.
  agent: z
    .object({
      description: z.string().default(""),
      category: z.enum(npPluginAgentCategories).optional(),
      tags: z.array(z.string()).default([]),
      configSchema: z.record(z.string(), z.unknown()).optional(),
    })
    .default({ description: "", tags: [] }),
  usesTokens: z.array(z.string()).default([]),
  styleSlots: z.record(z.string(), z.string()).default({}),
});

/**
 * Author-facing manifest shape: `apiVersion`, `allowedHosts`, and other
 * fields with schema defaults may be omitted. The parsed (runtime) manifest
 * always has them populated.
 */
export type NpPluginManifest = z.input<typeof npPluginManifestSchema>;

/** Parsed manifest with all defaults resolved. Use in host/registry code. */
export type NpPluginManifestResolved = z.output<typeof npPluginManifestSchema>;

// ────────────────────────────────────────────────────────────────────────
// Admin extension schema — validated by definePlugin.
// Fields inside NpAdminSettingsExtension reuse the collection field shape
// (NpFieldConfig from @nexpress/core), but plugin-sdk can't import core
// without a cycle, so accept them as opaque objects here. The admin
// renderer does the structural validation at render time.
// ────────────────────────────────────────────────────────────────────────

const adminFieldOpaqueSchema = z.record(z.string(), z.unknown());

export const npAdminSettingsSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  fields: z.array(adminFieldOpaqueSchema).min(1),
});

export const npAdminWidgetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["metric", "status"]),
  actionId: z.string().min(1),
  description: z.string().optional(),
});

export const npAdminActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  actionId: z.string().min(1),
  confirm: z.string().optional(),
  description: z.string().optional(),
});

export const npAdminTableSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  columns: z.array(z.object({ name: z.string().min(1), label: z.string().min(1) })).min(1),
  rowsActionId: z.string().min(1),
  emptyMessage: z.string().optional(),
});

export const npCollectionTabSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    collections: z.union([z.array(z.string().min(1)).min(1), z.literal("*")]),
    widgets: z.array(npAdminWidgetSchema).optional(),
    actions: z.array(npAdminActionSchema).optional(),
    description: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // A tab with neither widgets nor actions renders as an empty card —
    // almost certainly a plugin-author mistake. Force at least one.
    const widgetCount = value.widgets?.length ?? 0;
    const actionCount = value.actions?.length ?? 0;
    if (widgetCount === 0 && actionCount === 0) {
      ctx.addIssue({
        code: "custom",
        message: "collectionTabs entry must declare at least one widget or action",
        path: [],
      });
    }
  });

export const npAdminDashboardWidgetSchema = npAdminWidgetSchema.extend({
  priority: z.number().int().optional(),
});

export const npAdminExtensionSchema = z.object({
  settings: npAdminSettingsSchema.optional(),
  widgets: z.array(npAdminWidgetSchema).optional(),
  actions: z.array(npAdminActionSchema).optional(),
  tables: z.array(npAdminTableSchema).optional(),
  collectionTabs: z.array(npCollectionTabSchema).optional(),
  dashboardWidgets: z.array(npAdminDashboardWidgetSchema).optional(),
});
