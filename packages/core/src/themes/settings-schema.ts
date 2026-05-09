import type { ZodTypeAny } from "zod";

/**
 * Phase F.3 — server-side introspection of a theme's
 * `settingsSchema` Zod tree into a JSON metadata shape the
 * admin form generator consumes.
 *
 * The schema lives in the theme package (server bundle); we
 * don't ship the schema itself to the browser. Instead, this
 * function walks the tree once on the server, emits the
 * metadata as plain JSON, and the admin renders form fields
 * from the metadata. The browser doesn't need zod at runtime.
 *
 * Coverage in v0.2: text, url, color (regex heuristic), number,
 * boolean, enum, array(object), object. Anything else
 * introspects as `{ type: "unsupported" }` so the form generator
 * can render a JSON textarea fallback (operator can still edit;
 * a follow-up phase widens coverage).
 */

export type NpThemeSettingsField =
  | NpThemeSettingsTextField
  | NpThemeSettingsTextareaField
  | NpThemeSettingsPasswordField
  | NpThemeSettingsUrlField
  | NpThemeSettingsColorField
  | NpThemeSettingsNumberField
  | NpThemeSettingsBooleanField
  | NpThemeSettingsEnumField
  | NpThemeSettingsArrayField
  | NpThemeSettingsStringArrayField
  | NpThemeSettingsObjectField
  | NpThemeSettingsUnsupportedField;

interface NpThemeSettingsFieldBase {
  /** Field path key ("hero", "social.0.url", etc. — the
   *  introspector returns flat keys per node; nested objects
   *  carry their own children). */
  name: string;
  label?: string;
  description?: string;
  required: boolean;
  default?: unknown;
}

export interface NpThemeSettingsTextField extends NpThemeSettingsFieldBase {
  type: "text";
}

export interface NpThemeSettingsTextareaField extends NpThemeSettingsFieldBase {
  type: "textarea";
  /** Optional row count hint for the rendered `<textarea>`.
   *  Theme authors set this via `.meta({ widget: "textarea",
   *  rows: 6 })`. Defaults to 4 when unset. */
  rows?: number;
}

export interface NpThemeSettingsPasswordField extends NpThemeSettingsFieldBase {
  type: "password";
}

export interface NpThemeSettingsUrlField extends NpThemeSettingsFieldBase {
  type: "url";
}

export interface NpThemeSettingsColorField extends NpThemeSettingsFieldBase {
  type: "color";
}

export interface NpThemeSettingsNumberField extends NpThemeSettingsFieldBase {
  type: "number";
  int?: boolean;
  min?: number;
  max?: number;
}

export interface NpThemeSettingsBooleanField extends NpThemeSettingsFieldBase {
  type: "boolean";
}

export interface NpThemeSettingsEnumField extends NpThemeSettingsFieldBase {
  type: "enum";
  options: string[];
}

export interface NpThemeSettingsArrayField extends NpThemeSettingsFieldBase {
  type: "array";
  /** v0.2 supports `z.array(z.object(...))`. The element
   *  schema introspects as the array's child fields. */
  element: NpThemeSettingsField[];
}

/** Phase G follow-up — `z.array(z.string())`. Renders as a
 *  one-item-per-line input. Surfaced for OAuth scopes and
 *  similar string-list configs that don't fit the object-array
 *  shape; previously fell through to the JSON-textarea
 *  `unsupported` fallback. */
export interface NpThemeSettingsStringArrayField extends NpThemeSettingsFieldBase {
  type: "string-array";
}

export interface NpThemeSettingsObjectField extends NpThemeSettingsFieldBase {
  type: "object";
  fields: NpThemeSettingsField[];
}

export interface NpThemeSettingsUnsupportedField extends NpThemeSettingsFieldBase {
  type: "unsupported";
  /** Best-effort label for what was at this position so
   *  operators can recognize their schema in the JSON fallback. */
  zodTypeName: string;
}

// Heuristic: regex sources that look like a hex color check.
// We test against the regex `source` string (no flags, no
// surrounding slashes), so e.g. `/^#[0-9a-f]{6}$/i` arrives
// as `^#[0-9a-f]{6}$`. Matches both 6-digit and 3-to-8 digit
// variants, case sensitivity-agnostic via the `i` flag on
// the heuristic itself.
const COLOR_REGEX_PATTERNS = [
  /^\^#\[0-9a-f\]\{6\}\$$/i,
  /^\^#\[0-9a-f\]\{3,8\}\$$/i,
  /^\^#\[\\da-f\]\{6\}\$$/i,
];

interface ZodCheck {
  _zod?: { def?: { format?: string; pattern?: { source: string }; check?: string; value?: number } };
}

interface ZodDef {
  type: string;
  innerType?: { _def: ZodDef };
  defaultValue?: unknown;
  description?: string;
  shape?: Record<string, { _def: ZodDef; description?: string }>;
  entries?: Record<string, string>;
  element?: { _def: ZodDef };
  checks?: ZodCheck[];
}

interface ZodNode {
  _def: ZodDef;
  description?: string;
  shape?: Record<string, ZodNode>;
}

/**
 * Strip `default` / `optional` / `nullable` wrappers, returning
 * the inner schema, the resolved default value, and whether
 * the field is required (i.e. neither optional nor nullable).
 */
function unwrap(node: ZodNode): {
  inner: ZodNode;
  defaultValue: unknown;
  required: boolean;
} {
  let current = node;
  let defaultValue: unknown = undefined;
  let required = true;

  while (true) {
    const t = current._def.type;
    if (t === "default") {
      defaultValue =
        typeof current._def.defaultValue === "function"
          ? (current._def.defaultValue as () => unknown)()
          : current._def.defaultValue;
      current = (current._def.innerType as ZodNode | undefined) ?? current;
      if (!current._def.innerType) break;
      continue;
    }
    if (t === "optional" || t === "nullable") {
      required = false;
      const next = current._def.innerType as ZodNode | undefined;
      if (!next) break;
      current = next;
      continue;
    }
    break;
  }

  return { inner: current, defaultValue, required };
}

function detectStringFormat(
  checks: ZodCheck[] | undefined,
): "url" | "color" | "text" {
  if (!checks) return "text";
  for (const c of checks) {
    const fmt = c._zod?.def?.format;
    if (fmt === "url") return "url";
    if (fmt === "regex") {
      const src = c._zod?.def?.pattern?.source;
      if (src && COLOR_REGEX_PATTERNS.some((p) => p.test(src))) {
        return "color";
      }
    }
  }
  return "text";
}

/**
 * Phase F.3 follow-up — pull `.meta()` off a Zod node when
 * present. Used to read theme-author hints like
 * `{ widget: "textarea", rows: 6 }` that don't fit Zod's
 * narrow widget matrix (z.string() has no textarea variant
 * built in).
 */
function readMeta(node: ZodNode): Record<string, unknown> | undefined {
  const fn = (node as unknown as { meta?: () => unknown }).meta;
  if (typeof fn !== "function") return undefined;
  const out = fn.call(node);
  return out && typeof out === "object" ? (out as Record<string, unknown>) : undefined;
}

function detectNumberConstraints(
  checks: ZodCheck[] | undefined,
): { int?: boolean; min?: number; max?: number } {
  const out: { int?: boolean; min?: number; max?: number } = {};
  if (!checks) return out;
  for (const c of checks) {
    const def = c._zod?.def;
    if (!def) continue;
    if (def.format === "safeint" || def.check === "int") out.int = true;
    if (def.check === "greater_than" && typeof def.value === "number")
      out.min = def.value;
    if (def.check === "less_than" && typeof def.value === "number")
      out.max = def.value;
  }
  return out;
}

function introspectField(
  name: string,
  node: ZodNode,
): NpThemeSettingsField {
  const description = node.description;
  const { inner, defaultValue, required } = unwrap(node);
  const innerDef = inner._def;
  const base: NpThemeSettingsFieldBase = {
    name,
    description,
    label: description,
    required,
    default: defaultValue,
  };

  switch (innerDef.type) {
    case "string": {
      // Phase F.3 follow-up — `.meta({ widget: "textarea" })`
      // opts a `z.string()` into multi-line rendering. Theme
      // authors pair it with `.describe()` for the field
      // label; row count is optional (defaults to 4).
      //
      // Check `node` (outer) first then `inner` because Zod v4's
      // `.meta()` returns a new instance, so the meta lives at
      // whichever level the author called .meta() at:
      //
      //   z.string().meta({...}).optional()  → meta on inner string
      //   z.string().optional().meta({...})  → meta on outer optional
      //
      // Both patterns are valid in author code; both should work.
      const meta = readMeta(node) ?? readMeta(inner);
      if (meta && meta.sensitive === true) {
        return { ...base, type: "password" };
      }
      if (meta && meta.widget === "textarea") {
        const rows =
          typeof meta.rows === "number" && meta.rows > 0
            ? meta.rows
            : undefined;
        return {
          ...base,
          type: "textarea",
          ...(rows !== undefined ? { rows } : {}),
        };
      }
      const fmt = detectStringFormat(innerDef.checks);
      return { ...base, type: fmt };
    }
    case "number": {
      const c = detectNumberConstraints(innerDef.checks);
      return { ...base, type: "number", ...c };
    }
    case "boolean":
      return { ...base, type: "boolean" };
    case "enum": {
      const entries = innerDef.entries ?? {};
      return { ...base, type: "enum", options: Object.values(entries) };
    }
    case "array": {
      const element = innerDef.element as ZodNode | undefined;
      // v0.2 supports z.array(z.object(...)) — typed nested form
      // for each item.
      if (element?._def.type === "object" && element._def.shape) {
        const childFields = introspectShape(element._def.shape);
        return { ...base, type: "array", element: childFields };
      }
      // Phase G follow-up — z.array(z.string()) gets a dedicated
      // string-array widget (one item per line). Surfaced for
      // OAuth scopes and similar string-list configs.
      if (element?._def.type === "string") {
        return { ...base, type: "string-array" };
      }
      return { ...base, type: "unsupported", zodTypeName: "array" };
    }
    case "object": {
      const shape = innerDef.shape;
      if (shape) {
        return { ...base, type: "object", fields: introspectShape(shape) };
      }
      return { ...base, type: "unsupported", zodTypeName: "object" };
    }
    default:
      return {
        ...base,
        type: "unsupported",
        zodTypeName: innerDef.type ?? "unknown",
      };
  }
}

function introspectShape(
  shape: Record<string, { _def: ZodDef; description?: string }>,
): NpThemeSettingsField[] {
  const out: NpThemeSettingsField[] = [];
  for (const [name, raw] of Object.entries(shape)) {
    out.push(introspectField(name, raw as ZodNode));
  }
  return out;
}

/**
 * Walk a theme's `settingsSchema` (top-level z.object) and emit
 * the form metadata. Returns an empty array when the schema
 * isn't a top-level object — themes are expected to ship
 * `settingsSchema: z.object({...})` (validated implicitly: a
 * non-object top schema yields an empty form, signalling
 * "nothing to configure").
 */
export function introspectThemeSettingsSchema(
  schema: ZodTypeAny | undefined,
): NpThemeSettingsField[] {
  if (!schema) return [];
  // Strip any top-level default/optional/nullable wrapper before
  // checking for object shape — themes that wrap their whole
  // schema in `.default({...})` are unusual but valid; without
  // unwrap we'd silently render an empty form.
  const { inner } = unwrap(schema as unknown as ZodNode);
  if (inner._def.type !== "object" || !inner._def.shape) return [];
  return introspectShape(inner._def.shape);
}
