import type { NxCollectionConfig, NxFieldConfig } from "@nexpress/core";

/**
 * Strip the server-side function values from a collection config so it can be
 * passed from a server component into a "use client" component without React
 * throwing "Functions cannot be passed directly to Client Components".
 *
 * We drop `access`, `hooks`, `seo.urlPath` (and any other seo fn slot we
 * grow), and any per-field `validate`/`admin.condition` functions — the
 * admin UI never needs them and they're always re-evaluated on the server
 * anyway.
 */
export function toClientCollectionConfig(config: NxCollectionConfig): NxCollectionConfig {
  const { access: _access, hooks: _hooks, seo, fields, ...rest } = config;
  void _access;
  void _hooks;
  return {
    ...rest,
    ...(seo ? { seo: stripSeoFunctions(seo) } : {}),
    fields: fields.map(stripFieldFunctions),
  };
}

function stripSeoFunctions(seo: NonNullable<NxCollectionConfig["seo"]>): NonNullable<NxCollectionConfig["seo"]> {
  // Walk the seo block and drop any function-valued slot. `urlPath`
  // is the one that's always a function today; the loop survives a
  // future addition without another patch here.
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seo)) {
    if (typeof value === "function") continue;
    safe[key] = value;
  }
  return safe as NonNullable<NxCollectionConfig["seo"]>;
}

function stripFieldFunctions(field: NxFieldConfig): NxFieldConfig {
  if (field.type === "row") {
    return { ...field, fields: field.fields.map(stripFieldFunctions) };
  }
  if (field.type === "collapsible") {
    return { ...field, fields: field.fields.map(stripFieldFunctions) };
  }

  const { validate: _validate, admin, ...rest } = field;
  void _validate;

  const strippedAdmin = admin
    ? (() => {
        const { condition: _condition, ...safeAdmin } = admin;
        void _condition;
        return safeAdmin;
      })()
    : undefined;

  const withAdmin = strippedAdmin === undefined ? rest : { ...rest, admin: strippedAdmin };

  if (field.type === "group") {
    return { ...withAdmin, fields: field.fields.map(stripFieldFunctions) } as NxFieldConfig;
  }
  if (field.type === "array") {
    return { ...withAdmin, fields: field.fields.map(stripFieldFunctions) } as NxFieldConfig;
  }

  return withAdmin as NxFieldConfig;
}
