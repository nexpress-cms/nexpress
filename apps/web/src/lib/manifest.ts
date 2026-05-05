import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import type { NpBlockDefinition, NpBlockPropField } from "@nexpress/blocks";

export interface NpFieldManifest {
  name: string;
  type: NpFieldConfig["type"];
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  relationTo?: string | string[];
  hasMany?: boolean;
  integerOnly?: boolean;
  fields?: NpFieldManifest[];
}

export interface NpCollectionManifest {
  slug: string;
  labels: { singular: string; plural: string };
  description?: string;
  slug_auto?: boolean;
  versions: {
    drafts: boolean;
    max?: number;
  };
  fields: NpFieldManifest[];
}

export interface NpBlockManifest {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  propsSchema: NpBlockPropField[];
}

export interface NpPluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  capabilities: string[];
  hooks: string[];
  routes: Array<{ method: string; path: string }>;
}

export function collectionToManifest(config: NpCollectionConfig): NpCollectionManifest {
  return {
    slug: config.slug,
    labels: config.labels,
    description: config.admin?.description,
    slug_auto: Boolean(config.slugField),
    versions: {
      drafts: Boolean(config.versions?.drafts),
      max: config.versions?.max,
    },
    fields: config.fields.map(fieldToManifest),
  };
}

function fieldToManifest(field: NpFieldConfig): NpFieldManifest {
  if (field.type === "row" || field.type === "collapsible") {
    return {
      name: field.type === "collapsible" ? field.label : "row",
      type: field.type,
      fields: field.fields.map(fieldToManifest),
    };
  }

  const base: NpFieldManifest = {
    name: field.name,
    type: field.type,
    label: field.label,
    description: field.admin?.description,
    required: field.required,
    defaultValue: field.defaultValue,
  };

  switch (field.type) {
    case "select":
    case "radio":
      base.options = field.options;
      break;
    case "relationship":
      base.relationTo = field.relationTo;
      base.hasMany = field.hasMany;
      break;
    case "upload":
      base.relationTo = field.relationTo;
      break;
    case "number":
      base.integerOnly = field.integerOnly;
      break;
    case "group":
    case "array":
      base.fields = field.fields.map(fieldToManifest);
      break;
  }

  return base;
}

export function blockToManifest(definition: NpBlockDefinition): NpBlockManifest {
  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    propsSchema: definition.propsSchema,
  };
}
