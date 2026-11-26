import { z } from "zod";

import { npAnalyzeAgentGatewaySettings } from "../agent-contract/contract.js";
import { npAnalyzeStorageRuntimeConfig } from "../storage/contract.js";
import type { NpConfig } from "./types.js";

import { collectionConfigSchema } from "./collection-schema.js";
export { collectionConfigSchema } from "./collection-schema.js";

// Plugins are a mix of legacy NpPluginConfig (object with optional init fn)
// and SDK-built NpResolvedPluginLike (object with manifest). Preserve each
// definition here; the project contract validates identity/dependencies and
// the plugin host validates contribution registries before registration.
const pluginEntrySchema = z.unknown();

const storageRuntimeSchema = z
  .custom<NonNullable<NpConfig["storage"]>>()
  .superRefine((value, context) => {
    for (const entry of npAnalyzeStorageRuntimeConfig(value, "storage")) {
      context.addIssue({
        code: "custom",
        path: entry.path.split(".").slice(1),
        message: entry.message,
      });
    }
  });

const agentGatewaySettingsSchema = z
  .custom<NonNullable<NonNullable<NpConfig["agents"]>["gateway"]>>()
  .superRefine((value, context) => {
    const result = npAnalyzeAgentGatewaySettings(value);
    if (result.ok) return;
    for (const entry of result.issues) {
      context.addIssue({
        code: "custom",
        path: entry.path
          .replace(/^agent\.gatewaySettings\.?/u, "")
          .split(".")
          .filter(Boolean),
        message: entry.message,
      });
    }
  });

export const npConfigShapeSchema = z.strictObject({
  site: z.strictObject({
    name: z.string().min(1),
    url: z.string().url(),
  }),
  db: z.strictObject({
    connectionString: z.string().min(1),
  }),
  // Structural parsing keeps storage opaque so project diagnostics can
  // aggregate its canonical issues with semantic errors from other fields.
  storage: z.unknown().optional(),
  collections: z.array(z.lazy((): z.ZodType => collectionConfigSchema)),
  auth: z
    .strictObject({
      secret: z.string().min(32),
    })
    .optional(),
  plugins: z.array(pluginEntrySchema).optional(),
  agents: z
    .strictObject({
      gateway: agentGatewaySettingsSchema.optional(),
    })
    .optional(),
  themes: z.array(z.unknown()).optional(),
  i18n: z
    .strictObject({
      locales: z.array(z.string().min(1).max(35)).min(1),
      defaultLocale: z.string().min(1),
    })
    .refine((val) => val.locales.includes(val.defaultLocale), {
      message: "defaultLocale must be one of the declared locales",
      path: ["defaultLocale"],
    })
    .optional(),
  jobs: z
    .strictObject({
      stuckThreshold: z
        .strictObject({
          failed: z.number().int().nonnegative().optional(),
          expired: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const npConfigSchema = npConfigShapeSchema.extend({
  // Public direct consumers still get the exact discriminated runtime shape.
  storage: storageRuntimeSchema.optional(),
});
