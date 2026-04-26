import { type NxCollectionConfig, type NxFieldConfig } from "../config/types.js";

export function generateTypeScript(collections: NxCollectionConfig[]): string {
  const interfaces = collections.map((collection) => renderCollectionInterface(collection));
  return interfaces.join("\n\n");
}

function renderCollectionInterface(collection: NxCollectionConfig): string {
  const interfaceName = `${toPascalCase(collection.slug)}Document`;
  const fields = [
    'id: string;',
    'status: "draft" | "published" | "archived" | "pending";',
    'createdAt: Date;',
    'updatedAt: Date;',
    'createdBy: string | null;',
    'updatedBy: string | null;',
  ];

  if (collection.community?.memberWrite?.create) {
    fields.push('memberAuthorId: string | null;');
  }

  if (collection.slugField) {
    fields.push("slug: string;");
  }

  if (collection.versions?.drafts) {
    fields.push('_status: "draft" | "published";');
  }

  fields.push(...renderFields(collection.fields));

  return [`export interface ${interfaceName} {`, ...fields.map((field) => `  ${field}`), "}"].join("\n");
}

function renderFields(fields: NxFieldConfig[], prefix: string[] = []): string[] {
  const lines: string[] = [];

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      lines.push(...renderFields(field.fields, prefix));
      continue;
    }

    const fieldName = field.type === "group" ? getPropertyName(prefix, field.name) : "";

    if (field.type === "group") {
      const groupType = renderObjectType(field.fields);
      lines.push(`${fieldName}: ${applyNullability(groupType, field.required)};`);
      continue;
    }

    const propertyName = getPropertyName(prefix, field.name);
    const typeSource = getTypeSource(field);
    lines.push(`${propertyName}: ${applyNullability(typeSource, field.required)};`);
  }

  return lines;
}

function renderObjectType(fields: NxFieldConfig[]): string {
  const members = renderFields(fields).map((field) => `  ${field}`);
  return [`{`, ...members, `}`].join("\n");
}

function getTypeSource(field: Exclude<NxFieldConfig, { type: "row" | "collapsible" | "group" }>): string {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "select":
    case "radio":
      return "string";
    case "number":
      return "number";
    case "checkbox":
      return "boolean";
    case "date":
      return "Date";
    case "upload":
      return "string";
    case "relationship":
      return field.hasMany ? "string[]" : "string";
    case "array":
      return `Array<${renderObjectType(field.fields)}>`;
    case "richText":
    case "blocks":
    case "json":
      return "unknown";
    default:
      return "unknown";
  }
}

function applyNullability(typeSource: string, required?: boolean): string {
  return required ? typeSource : `${typeSource} | null`;
}

function getPropertyName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix[0]}${prefix.slice(1).map(toPascalCase).join("")}${toPascalCase(name)}`;
}

function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(toPascalCase).join("")}`;
}

function toPascalCase(value: string): string {
  return splitName(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}
