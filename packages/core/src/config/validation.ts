import { z } from "zod";

import { npAnalyzeStorageRuntimeConfig } from "../storage/contract.js";
import type { NpConfig } from "./types.js";

const functionSchema = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === "function",
);

/**
 * Serializable condition predicate (NpFieldConditionExpr) — the
 * Zod mirror of the type defined in `config/types.ts`. Each operator is exact
 * so malformed or ambiguous expressions fail at the collection definition
 * boundary. `z.unknown()` on comparison values still supports the wide JSON
 * payloads the editor uses.
 */
const conditionExprSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.strictObject({ when: z.string().min(1), equals: z.unknown() }),
    z.strictObject({ when: z.string().min(1), notEquals: z.unknown() }),
    z.strictObject({ when: z.string().min(1), in: z.array(z.unknown()) }),
    z.strictObject({ when: z.string().min(1), notIn: z.array(z.unknown()) }),
    z.strictObject({ when: z.string().min(1), exists: z.boolean() }),
    z.strictObject({ all: z.array(conditionExprSchema).min(1) }),
    z.strictObject({ any: z.array(conditionExprSchema).min(1) }),
  ]),
);

const fieldBaseSchema = z.strictObject({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  hidden: z.boolean().optional(),
  admin: z
    .strictObject({
      description: z.string().min(1).optional(),
      placeholder: z.string().optional(),
      readOnly: z.boolean().optional(),
      // Accepts either the legacy function form (server-only, stripped
      // at the RSC boundary) or the serializable expression form
      // (#764). The runtime evaluator handles both.
      condition: z.union([functionSchema, conditionExprSchema]).optional(),
      width: z.string().optional(),
      kind: z.enum(["templatePicker", "title"]).optional(),
      position: z.enum(["main", "sidebar"]).optional(),
      group: z.string().min(1).optional(),
      _themeOrigin: z.string().min(1).optional(),
    })
    .optional(),
  validate: functionSchema.optional(),
});

const optionSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string().min(1),
});

const fieldSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("type", [
    fieldBaseSchema.extend({
      type: z.literal("text"),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      unique: z.boolean().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("textarea"),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      rows: z.number().int().positive().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("number"),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
      integerOnly: z.boolean().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("richText"),
      editor: z.strictObject({ features: z.array(z.string().min(1)).optional() }).optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("blocks"),
      allowedBlocks: z.array(z.string().min(1)).optional(),
      minRows: z.number().int().nonnegative().optional(),
      maxRows: z.number().int().nonnegative().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("checkbox"),
      defaultValue: z.boolean().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("date"),
      pickerOptions: z
        .strictObject({
          format: z.string().optional(),
          includeTime: z.boolean().optional(),
        })
        .optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("upload"),
      relationTo: z.string().min(1),
    }),
    fieldBaseSchema.extend({
      type: z.literal("relationship"),
      relationTo: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      hasMany: z.boolean().optional(),
      filterOptions: z.record(z.string(), z.unknown()).optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("select"),
      options: z.array(optionSchema).min(1),
      hasMany: z.boolean().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("radio"),
      options: z.array(optionSchema).min(1),
    }),
    fieldBaseSchema.extend({
      type: z.literal("email"),
    }),
    fieldBaseSchema.extend({
      type: z.literal("json"),
    }),
    fieldBaseSchema.extend({
      type: z.literal("array"),
      fields: z.array(fieldSchema).min(1),
      minRows: z.number().int().nonnegative().optional(),
      maxRows: z.number().int().nonnegative().optional(),
    }),
    fieldBaseSchema.extend({
      type: z.literal("group"),
      fields: z.array(fieldSchema).min(1),
    }),
    z.strictObject({
      type: z.literal("row"),
      fields: z.array(fieldSchema).min(1),
    }),
    z.strictObject({
      type: z.literal("collapsible"),
      label: z.string().min(1),
      fields: z.array(fieldSchema).min(1),
    }),
  ]),
);

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

const adminGroupMetaSchema = z.strictObject({
  icon: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

const collectionKindSchema = z.strictObject({
  label: z.string().min(1),
  labelPlural: z.string().min(1),
  icon: z.string().min(1).optional(),
  urlPattern: z.string().min(1).optional(),
  hierarchical: z.boolean().optional(),
  _themeOrigin: z.string().min(1).optional(),
});

export const collectionConfigSchema = z.strictObject({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  labels: z.strictObject({
    singular: z.string().min(1),
    plural: z.string().min(1),
  }),
  slugField: z
    .union([
      z.boolean(),
      z.strictObject({
        useField: z.string().min(1).optional(),
        unique: z.boolean().optional(),
      }),
    ])
    .optional(),
  i18n: z.boolean().optional(),
  fields: z.array(fieldSchema).min(1),
  access: z
    .strictObject({
      create: functionSchema.optional(),
      read: functionSchema.optional(),
      update: functionSchema.optional(),
      delete: functionSchema.optional(),
    })
    .optional(),
  hooks: z
    .strictObject({
      beforeCreate: z.array(functionSchema).optional(),
      afterCreate: z.array(functionSchema).optional(),
      beforeUpdate: z.array(functionSchema).optional(),
      afterUpdate: z.array(functionSchema).optional(),
      beforeDelete: z.array(functionSchema).optional(),
      afterDelete: z.array(functionSchema).optional(),
      beforeRead: z.array(functionSchema).optional(),
      afterRead: z.array(functionSchema).optional(),
    })
    .optional(),
  versions: z
    .strictObject({
      drafts: z
        .union([
          z.boolean(),
          z.strictObject({
            autosave: z.boolean().optional(),
            autosaveInterval: z.number().int().positive().optional(),
          }),
        ])
        .optional(),
      max: z.number().int().positive().optional(),
    })
    .optional(),
  community: z
    .strictObject({
      comments: z.boolean().optional(),
      reactions: z.boolean().optional(),
      views: z.boolean().optional(),
      reports: z.boolean().optional(),
      memberWrite: z
        .strictObject({
          create: z.boolean().optional(),
          update: z.boolean().optional(),
          delete: z.boolean().optional(),
          writableFields: z.array(z.string().min(1)).optional(),
          access: z
            .strictObject({
              create: functionSchema.optional(),
              update: functionSchema.optional(),
              delete: functionSchema.optional(),
            })
            .optional(),
          defaultStatus: z.enum(["published", "pending"]).optional(),
          resolveCreateStatus: functionSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  seo: z
    .strictObject({
      urlPath: functionSchema.optional(),
      changefreq: z
        .enum(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"])
        .optional(),
      priority: z.number().min(0).max(1).optional(),
    })
    .optional(),
  timestamps: z.boolean().optional(),
  admin: z
    .strictObject({
      listColumns: z.array(z.string().min(1)).optional(),
      defaultSort: z.string().min(1).optional(),
      group: z.string().min(1).optional(),
      hidden: z.boolean().optional(),
      description: z.string().optional(),
      components: z
        .strictObject({
          listView: z.string().optional(),
          editView: z.string().optional(),
          createView: z.string().optional(),
        })
        .optional(),
      navMembership: z.boolean().optional(),
      icon: z.string().min(1).optional(),
      _themeOrigin: z.string().min(1).optional(),
      kinds: z.record(z.string().min(1), collectionKindSchema).optional(),
      groupMeta: z.record(z.string().min(1), adminGroupMetaSchema).optional(),
    })
    .optional(),
  upload: z
    .strictObject({
      maxFileSize: z.number().positive().optional(),
      allowedMimeTypes: z.array(z.string().min(1)).optional(),
      imageSizes: z
        .array(
          z.strictObject({
            name: z.string().min(1),
            width: z.number().positive(),
            height: z.number().positive().optional(),
            crop: z.enum(["center", "top", "bottom", "left", "right"]).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
