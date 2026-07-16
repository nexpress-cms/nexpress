import type { NpBlockMetadata, NpBlockPropField } from "@nexpress/blocks";
import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import type {
  NpBlockDiscoveryItem,
  NpBlockDiscoveryPropField,
  NpCollectionDiscoveryField,
  NpCollectionDiscoveryItem,
  NpDiscoveryJsonValue,
} from "@nexpress/core/discovery";

export type NpFieldManifest = NpCollectionDiscoveryField;
export type NpCollectionManifest = NpCollectionDiscoveryItem;
export type NpBlockManifest = NpBlockDiscoveryItem;

function sourceName(themeOrigin: string | undefined, fallback = "project"): string {
  return themeOrigin ? `theme:${themeOrigin}` : fallback;
}

function wireValue(value: unknown): NpDiscoveryJsonValue {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new TypeError("Discovery defaults cannot contain invalid dates.");
    return value.toISOString();
  }
  return value as NpDiscoveryJsonValue;
}

function optional<T extends object, Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): T | Record<Key, Value> {
  return value === undefined ? ({} as T) : ({ [key]: value } as Record<Key, Value>);
}

export function collectionToManifest(config: NpCollectionConfig): NpCollectionManifest {
  const source = sourceName(config.admin?._themeOrigin);
  return {
    slug: config.slug,
    source,
    labels: { ...config.labels },
    ...optional("description", config.admin?.description),
    slug_auto: Boolean(config.slugField),
    i18n: config.i18n === true,
    timestamps: config.timestamps !== false,
    versions: {
      drafts: Boolean(config.versions?.drafts),
      ...optional("max", config.versions?.max),
    },
    fields: config.fields.map((field) => fieldToManifest(field, source)),
  };
}

function fieldToManifest(field: NpFieldConfig, parentSource: string): NpFieldManifest {
  if (field.type === "row" || field.type === "collapsible") {
    return {
      name: field.type === "collapsible" ? field.label : "row",
      type: field.type,
      source: parentSource,
      ...optional("label", field.type === "collapsible" ? field.label : undefined),
      fields: field.fields.map((nested) => fieldToManifest(nested, parentSource)),
    };
  }

  const source = sourceName(field.admin?._themeOrigin, parentSource);
  const base: NpCollectionDiscoveryField = {
    name: field.name,
    type: field.type,
    source,
    ...optional("label", field.label),
    ...optional("description", field.admin?.description),
    ...optional("required", field.required),
    ...(field.defaultValue === undefined ? {} : { defaultValue: wireValue(field.defaultValue) }),
  };

  switch (field.type) {
    case "select":
      return {
        ...base,
        ...optional("hasMany", field.hasMany),
        options: field.options.map((entry) => ({ ...entry })),
      };
    case "radio":
      return { ...base, options: field.options.map((entry) => ({ ...entry })) };
    case "relationship":
      return {
        ...base,
        relationTo: Array.isArray(field.relationTo) ? [...field.relationTo] : field.relationTo,
        ...optional("hasMany", field.hasMany),
      };
    case "upload":
      return { ...base, relationTo: field.relationTo };
    case "number":
      return { ...base, ...optional("integerOnly", field.integerOnly) };
    case "group":
    case "array":
      return {
        ...base,
        fields: field.fields.map((nested) => fieldToManifest(nested, source)),
      };
    default:
      return base;
  }
}

function propFieldToManifest(field: NpBlockPropField): NpBlockDiscoveryPropField {
  return {
    name: field.name,
    label: field.label,
    type: field.type,
    ...optional("translatable", field.translatable),
    ...optional("required", field.required),
    ...(field.defaultValue === undefined ? {} : { defaultValue: wireValue(field.defaultValue) }),
    ...(field.options ? { options: field.options.map((entry) => ({ ...entry })) } : {}),
    ...optional("description", field.description),
    ...optional("placeholder", field.placeholder),
    ...optional("min", field.min),
    ...optional("max", field.max),
    ...optional("step", field.step),
    ...optional("pattern", field.pattern),
    ...optional("patternMessage", field.patternMessage),
    ...optional("rows", field.rows),
    ...optional("group", field.group),
    ...(field.hiddenWhen
      ? { hiddenWhen: field.hiddenWhen.map(([name, value]) => [name, wireValue(value)] as const) }
      : {}),
    ...(field.visibleWhen
      ? { visibleWhen: field.visibleWhen.map(([name, value]) => [name, wireValue(value)] as const) }
      : {}),
    ...(field.itemSchema
      ? { itemSchema: field.itemSchema.map((nested) => propFieldToManifest(nested)) }
      : {}),
    ...(field.itemDefault
      ? { itemDefault: field.itemDefault as Record<string, NpDiscoveryJsonValue> }
      : {}),
    ...(field.accept ? { accept: [...field.accept] } : {}),
  };
}

export function blockToManifest(metadata: NpBlockMetadata): NpBlockManifest {
  return {
    type: metadata.type,
    label: metadata.label,
    source: metadata.source ?? "built-in",
    ...optional("description", metadata.description),
    ...optional("icon", metadata.icon),
    ...optional("iconKind", metadata.iconKind),
    ...optional("category", metadata.category),
    keywords: [...(metadata.keywords ?? [])],
    defaultProps: metadata.defaultProps as Record<string, NpDiscoveryJsonValue>,
    propsSchema: metadata.propsSchema.map((field) => propFieldToManifest(field)),
    acceptsChildren: metadata.acceptsChildren === true,
    summaryFields: [...(metadata.summaryFields ?? [])],
    allowedChildTypes: [...(metadata.allowedChildTypes ?? [])],
    ...optional("minChildren", metadata.minChildren),
    ...optional("maxChildren", metadata.maxChildren),
  };
}
