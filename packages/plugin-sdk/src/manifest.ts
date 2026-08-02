import { z } from "zod";
import { npPluginIdMaxLength, npPluginIdPattern } from "@nexpress/core/settings";

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
  id: z.string().max(npPluginIdMaxLength).regex(new RegExp(npPluginIdPattern, "u")),
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
      patterns: z.array(z.string()).default([]),
      templates: z.array(z.string()).default([]),
      translations: z.array(z.string()).default([]),
      collections: z.array(z.string()).default([]),
      adminExtensions: z.array(z.string()).default([]),
      actions: z.array(z.string()).default([]),
      apiRoutes: z.array(z.string()).default([]),
      pageRoutes: z.array(z.string()).default([]),
      scheduledTasks: z.array(z.string()).default([]),
      hooks: z.array(z.string()).default([]),
    })
    .default({
      blocks: [],
      patterns: [],
      templates: [],
      translations: [],
      collections: [],
      adminExtensions: [],
      actions: [],
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

const npAdminTableRowActionFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["text", "textarea", "select"]),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    options: z
      .array(z.object({ label: z.string().min(1), value: z.string().min(1) }))
      .min(1)
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && !field.options) {
      ctx.addIssue({ code: "custom", message: "select fields require options" });
    }
    if (field.type !== "select" && field.options) {
      ctx.addIssue({ code: "custom", message: "only select fields may declare options" });
    }
    const optionValues = field.options?.map((option) => option.value) ?? [];
    if (new Set(optionValues).size !== optionValues.length) {
      ctx.addIssue({ code: "custom", message: "select option values must be unique" });
    }
  });

const npAdminTableRowDispatchActionSchema = z.object({
  type: z.literal("action").optional(),
  id: z.string().min(1),
  label: z.string().min(1),
  actionId: z.string().min(1),
  rowFields: z.array(z.string().min(1)).min(1),
  fields: z.array(npAdminTableRowActionFieldSchema).optional(),
  visibleWhen: z
    .object({
      field: z.string().min(1),
      oneOf: z.array(z.union([z.string(), z.number().finite(), z.boolean()])).min(1),
    })
    .optional(),
  confirm: z.string().optional(),
  description: z.string().optional(),
  result: z.enum(["toast", "details"]).optional(),
});

const npAdminTableRowDownloadActionSchema = z.object({
  type: z.literal("download"),
  id: z.string().min(1),
  label: z.string().min(1),
  routePath: z.string().min(1),
  query: z.array(z.object({ name: z.string().min(1), rowField: z.string().min(1) })).min(1),
  visibleWhen: z
    .object({
      field: z.string().min(1),
      oneOf: z.array(z.union([z.string(), z.number().finite(), z.boolean()])).min(1),
    })
    .optional(),
  description: z.string().optional(),
});

const npAdminTableRowActionSchema = z.union([
  npAdminTableRowDispatchActionSchema,
  npAdminTableRowDownloadActionSchema,
]);

export const npAdminTableSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    columns: z.array(z.object({ name: z.string().min(1), label: z.string().min(1) })).min(1),
    rowsActionId: z.string().min(1),
    rowActions: z.array(npAdminTableRowActionSchema).optional(),
    emptyMessage: z.string().optional(),
  })
  .superRefine((table, ctx) => {
    const actionIds = table.rowActions?.map((action) => action.id) ?? [];
    if (new Set(actionIds).size !== actionIds.length) {
      ctx.addIssue({ code: "custom", message: "table row action ids must be unique" });
    }
    for (const [index, action] of (table.rowActions ?? []).entries()) {
      if (action.type === "download") {
        const queryNames = action.query.map((entry) => entry.name);
        if (new Set(queryNames).size !== queryNames.length) {
          ctx.addIssue({
            code: "custom",
            message: "download query names must be unique",
            path: ["rowActions", index, "query"],
          });
        }
        continue;
      }
      if (new Set(action.rowFields).size !== action.rowFields.length) {
        ctx.addIssue({
          code: "custom",
          message: "rowFields must be unique",
          path: ["rowActions", index, "rowFields"],
        });
      }
      const fieldNames = action.fields?.map((field) => field.name) ?? [];
      if (new Set(fieldNames).size !== fieldNames.length) {
        ctx.addIssue({
          code: "custom",
          message: "field names must be unique",
          path: ["rowActions", index, "fields"],
        });
      }
    }
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
