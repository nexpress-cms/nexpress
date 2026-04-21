import type { NxCollectionConfig, NxFieldConfig } from "@nexpress/core";
import type { NxBlockDefinition, NxBlockPropField } from "@nexpress/blocks";

export interface NxFieldManifest {
  name: string;
  type: NxFieldConfig["type"];
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  relationTo?: string | string[];
  hasMany?: boolean;
  integerOnly?: boolean;
  fields?: NxFieldManifest[];
}

export interface NxCollectionManifest {
  slug: string;
  labels: { singular: string; plural: string };
  description?: string;
  slug_auto?: boolean;
  versions: {
    drafts: boolean;
    max?: number;
  };
  fields: NxFieldManifest[];
}

export interface NxBlockManifest {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  propsSchema: NxBlockPropField[];
}

export interface NxPluginManifest {
  id: string;
  name: string;
  hooks: string[];
  routes: Array<{ method: string; path: string }>;
}

export function collectionToManifest(config: NxCollectionConfig): NxCollectionManifest {
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

function fieldToManifest(field: NxFieldConfig): NxFieldManifest {
  if (field.type === "row" || field.type === "collapsible") {
    return {
      name: field.type === "collapsible" ? field.label : "row",
      type: field.type,
      fields: field.fields.map(fieldToManifest),
    };
  }

  const base: NxFieldManifest = {
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

export function blockToManifest(definition: NxBlockDefinition): NxBlockManifest {
  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    propsSchema: definition.propsSchema,
  };
}
