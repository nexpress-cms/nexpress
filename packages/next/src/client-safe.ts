import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";

/**
 * Strip the server-side function values from a collection config so it can be
 * passed from a server component into a "use client" component without React
 * throwing "Functions cannot be passed directly to Client Components".
 *
 * We drop `access`, `hooks`, `seo.urlPath` (and any other seo fn slot we
 * grow), and any per-field `validate`/`admin.condition` functions — the
 * admin UI never needs them and they're always re-evaluated on the server
 * anyway.
 *
 * When `activeThemeId` is provided, also drops fields whose
 * `admin._themeOrigin` doesn't match. `mergeThemeRequirements` stamps every
 * theme-contributed field with its origin so the admin doesn't surface
 * Portfolio's sidebar groups while Magazine is active. The same gate
 * already runs for collections / kinds / blocks / patterns in the admin
 * layout; this is the field-level pair.
 */
export function toClientCollectionConfig(
  config: NpCollectionConfig,
  activeThemeId?: string | null,
): NpCollectionConfig {
  const { access: _access, hooks: _hooks, seo, fields, ...rest } = config;
  void _access;
  void _hooks;
  return {
    ...rest,
    ...(seo ? { seo: stripSeoFunctions(seo) } : {}),
    fields: fields
      .map((f) => filterFieldByThemeOrigin(f, activeThemeId))
      .filter((f): f is NpFieldConfig => f !== null)
      .map(stripFieldFunctions),
  };
}

/**
 * Drop fields whose `admin._themeOrigin` doesn't match the active theme.
 * Recurses into `row` / `collapsible` containers so a theme-contributed
 * field nested in a row still gets gated. `group` / `array` keep their
 * structure — their nested fields are operator-authored when the parent
 * is operator-authored. Returns null when the field itself should be
 * dropped (so the caller can filter it out).
 */
function filterFieldByThemeOrigin(
  field: NpFieldConfig,
  activeThemeId: string | null | undefined,
): NpFieldConfig | null {
  if (field.type === "row" || field.type === "collapsible") {
    const kept = field.fields
      .map((c) => filterFieldByThemeOrigin(c, activeThemeId))
      .filter((c): c is NpFieldConfig => c !== null);
    if (kept.length === 0) return null;
    return { ...field, fields: kept };
  }
  if (activeThemeId === undefined) return field;
  const origin = "admin" in field ? field.admin?._themeOrigin : undefined;
  if (origin && origin !== activeThemeId) return null;
  return field;
}

function stripSeoFunctions(
  seo: NonNullable<NpCollectionConfig["seo"]>,
): NonNullable<NpCollectionConfig["seo"]> {
  // Walk the seo block and drop any function-valued slot. `urlPath`
  // is the one that's always a function today; the loop survives a
  // future addition without another patch here.
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seo)) {
    if (typeof value === "function") continue;
    safe[key] = value;
  }
  return safe;
}

function stripFieldFunctions(field: NpFieldConfig): NpFieldConfig {
  if (field.type === "row") {
    return { ...field, fields: field.fields.map(stripFieldFunctions) };
  }
  if (field.type === "collapsible") {
    return { ...field, fields: field.fields.map(stripFieldFunctions) };
  }

  const { validate: _validate, admin, ...rest } = field;
  void _validate;

  // `admin.condition` may be a function (`NpFieldCondition`) — strip
  // those because RSC can't serialize them. Expression-form
  // conditions (`NpFieldConditionExpr`, plain JSON) survive
  // verbatim so the admin client can re-evaluate them against
  // live form values. Migrating function conditions to the
  // expression form is the operator's escape from "field doesn't
  // hide in the browser" (#763).
  const strippedAdmin = admin
    ? (() => {
        if (typeof admin.condition === "function") {
          const fieldName =
            "name" in field && typeof field.name === "string" ? field.name : "<unknown>";
          if (process.env.NODE_ENV !== "production") {
            // One-line dev warning so theme authors who wrote
            // `condition: (data) => ...` see why their field
            // still shows up in the admin browser. Production
            // stays quiet to avoid log noise on hot paths.
            console.warn(
              `[nexpress] Field "${fieldName}" uses a function-form admin.condition. ` +
                `Functions are stripped at the RSC boundary, so the field will always ` +
                `show in the admin editor. Migrate to the serializable expression form ` +
                `(e.g. { when: "kind", equals: "doc" }) to enable client-side hiding. ` +
                `Server-side validation still honors the function.`,
            );
          }
          const { condition: _condition, ...safeAdmin } = admin;
          void _condition;
          return safeAdmin;
        }
        return admin;
      })()
    : undefined;

  const withAdmin = strippedAdmin === undefined ? rest : { ...rest, admin: strippedAdmin };

  if (field.type === "group") {
    return { ...withAdmin, fields: field.fields.map(stripFieldFunctions) } as NpFieldConfig;
  }
  if (field.type === "array") {
    return { ...withAdmin, fields: field.fields.map(stripFieldFunctions) } as NpFieldConfig;
  }

  return withAdmin;
}
