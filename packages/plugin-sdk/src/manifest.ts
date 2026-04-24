import { z } from "zod";

import { nxPluginAgentCategories, nxPluginCapabilities } from "./types.js";

const nxPluginVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/);

/**
 * Version of the manifest schema itself — NOT the plugin's own version.
 * Bumps when the manifest shape changes in a backwards-incompatible way;
 * older plugins can continue to target older apiVersion values while a newer
 * host negotiates compatibility. The value is a literal so host code can
 * switch on it without stringly-typed parsing.
 */
export const NX_PLUGIN_MANIFEST_API_VERSION = "1" as const;

export const nxPluginManifestSchema = z.object({
  apiVersion: z.literal("1").default("1"),
  id: z.string().regex(/^(@[\w-]+\/)?[\w-]+$/),
  version: nxPluginVersionSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.object({
    name: z.string(),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
  license: z.string(),
  nexpress: z.object({
    minVersion: nxPluginVersionSchema,
    maxVersion: nxPluginVersionSchema.optional(),
  }),
  capabilities: z.array(z.enum(nxPluginCapabilities)),
  allowedHosts: z.array(z.string()).default([]),
  provides: z
    .object({
      blocks: z.array(z.string()).default([]),
      fields: z.array(z.string()).default([]),
      collections: z.array(z.string()).default([]),
      adminExtensions: z.array(z.string()).default([]),
      apiRoutes: z.array(z.string()).default([]),
      hooks: z.array(z.string()).default([]),
    })
    .default({
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    }),
  agent: z.object({
    description: z.string(),
    category: z.enum(nxPluginAgentCategories),
    tags: z.array(z.string()).default([]),
    configSchema: z.record(z.string(), z.unknown()).optional(),
  }),
  usesTokens: z.array(z.string()).default([]),
  styleSlots: z.record(z.string(), z.string()).default({}),
});

/**
 * Author-facing manifest shape: `apiVersion`, `allowedHosts`, and other
 * fields with schema defaults may be omitted. The parsed (runtime) manifest
 * always has them populated.
 */
export type NxPluginManifest = z.input<typeof nxPluginManifestSchema>;

/** Parsed manifest with all defaults resolved. Use in host/registry code. */
export type NxPluginManifestResolved = z.output<typeof nxPluginManifestSchema>;
