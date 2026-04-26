import { z } from "zod";

const functionSchema = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === "function",
);

const fieldBaseSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  hidden: z.boolean().optional(),
  admin: z
    .object({
      description: z.string().min(1).optional(),
      placeholder: z.string().optional(),
      readOnly: z.boolean().optional(),
      condition: functionSchema.optional(),
      width: z.string().optional(),
    })
    .optional(),
  validate: functionSchema.optional(),
});

const optionSchema = z.object({
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
      editor: z.object({ features: z.array(z.string()).optional() }).optional(),
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
        .object({
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
    z.object({
      type: z.literal("row"),
      fields: z.array(fieldSchema).min(1),
    }),
    z.object({
      type: z.literal("collapsible"),
      label: z.string().min(1),
      fields: z.array(fieldSchema).min(1),
    }),
  ]),
);

const imageSizeSchema = z.object({
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive().optional(),
  crop: z.enum(["center", "top", "bottom", "left", "right"]).optional(),
});

// Discriminated union ties `adapter` to its required backend block —
// previously both `local` and `s3` were optional regardless of the
// adapter choice, so a config with `{ adapter: "s3" }` and no `s3`
// block passed validation and only blew up at runtime when the storage
// factory tried to read the missing block. (#64)
const storageSchema = z.discriminatedUnion("adapter", [
  z.object({
    adapter: z.literal("local"),
    local: z.object({
      directory: z.string().min(1),
      baseUrl: z.string().min(1),
    }),
  }),
  z.object({
    adapter: z.literal("s3"),
    s3: z.object({
      bucket: z.string().min(1),
      region: z.string().min(1),
      endpoint: z.string().url().optional(),
    }),
  }),
]);

// Plugins are a mix of legacy NxPluginConfig (object with optional init fn)
// and SDK-built NxResolvedPluginLike (object with manifest). Parse with
// `z.unknown()` — deeper validation happens when loadPlugins() runs.
const pluginEntrySchema = z.unknown();

export const nxConfigSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    url: z.string().url(),
  }),
  db: z.object({
    connectionString: z.string(),
    pool: z
      .object({
        max: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  storage: storageSchema.optional(),
  collections: z.array(z.lazy((): z.ZodType => collectionConfigSchema)),
  blocks: z.array(z.unknown()).optional(),
  editor: z
    .object({
      features: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  images: z
    .object({
      sizes: z.array(imageSizeSchema).optional(),
      format: z.enum(["webp", "avif", "jpeg", "png"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  auth: z
    .object({
      secret: z.string().min(1),
      tokenExpiration: z.number().int().positive().optional(),
      refreshTokenExpiration: z.number().int().positive().optional(),
      maxLoginAttempts: z.number().int().positive().optional(),
      lockoutDuration: z.number().int().positive().optional(),
    })
    .optional(),
  plugins: z.array(pluginEntrySchema).optional(),
  typescript: z.unknown().optional(),
});

export const collectionConfigSchema = z.object({
  slug: z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]*$/),
  labels: z.object({
    singular: z.string().min(1),
    plural: z.string().min(1),
  }),
  slugField: z
    .union([
      z.boolean(),
      z.object({
        useField: z.string().min(1).optional(),
        unique: z.boolean().optional(),
      }),
    ])
    .optional(),
  fields: z.array(fieldSchema).min(1),
  access: z
    .object({
      create: functionSchema.optional(),
      read: functionSchema.optional(),
      update: functionSchema.optional(),
      delete: functionSchema.optional(),
    })
    .optional(),
  hooks: z
    .object({
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
    .object({
      drafts: z
        .union([
          z.boolean(),
          z.object({
            autosave: z.boolean().optional(),
            autosaveInterval: z.number().int().positive().optional(),
          }),
        ])
        .optional(),
      max: z.number().int().positive().optional(),
    })
    .optional(),
  community: z
    .object({
      comments: z.boolean().optional(),
      memberWrite: z
        .object({
          create: z.boolean().optional(),
          update: z.boolean().optional(),
          delete: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  timestamps: z.boolean().optional(),
  admin: z
    .object({
      listColumns: z.array(z.string().min(1)).optional(),
      defaultSort: z.string().min(1).optional(),
      group: z.string().min(1).optional(),
      hidden: z.boolean().optional(),
      description: z.string().optional(),
      components: z
        .object({
          listView: z.string().optional(),
          editView: z.string().optional(),
          createView: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  upload: z
    .object({
      maxFileSize: z.number().positive().optional(),
      allowedMimeTypes: z.array(z.string().min(1)).optional(),
      imageSizes: z
        .array(
          z.object({
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
