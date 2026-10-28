const reasons = [
  "connection-checkout-timeout",
  "connection-handshake-timeout",
  "statement-timeout",
  "database-cancelled",
  "connection-unavailable",
  "site-context-missing",
  "other",
] as const;

/** Optional metadata from an explicitly installed preview error reporter, never raw errors. */
export interface NpSiteBuildApplicationErrorDiagnosticV1 {
  schemaVersion: "np.site-build-application-error-diagnostic.v1";
  reasons: Array<(typeof reasons)[number]>;
  truncated: boolean;
}

/** Reconstruct a bounded allowlist; diagnostic input cannot add fields or affect failure policy. */
export function projectSiteBuildApplicationErrorDiagnosticV1(
  value: unknown,
): NpSiteBuildApplicationErrorDiagnosticV1 | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3 ||
      !keys.every((key) => ["schemaVersion", "reasons", "truncated"].includes(String(key)))
    )
      return null;
    const schema = Object.getOwnPropertyDescriptor(value, "schemaVersion"),
      entries = Object.getOwnPropertyDescriptor(value, "reasons"),
      truncated = Object.getOwnPropertyDescriptor(value, "truncated");
    if (
      !schema ||
      !("value" in schema) ||
      schema.value !== "np.site-build-application-error-diagnostic.v1" ||
      !entries ||
      !("value" in entries) ||
      !Array.isArray(entries.value) ||
      entries.value.length > 8 ||
      !truncated ||
      !("value" in truncated) ||
      typeof truncated.value !== "boolean"
    )
      return null;
    const input: unknown[] = entries.value;
    if (
      Object.getPrototypeOf(input) !== Array.prototype ||
      Reflect.ownKeys(input).length !== input.length + 1
    )
      return null;
    const projected: NpSiteBuildApplicationErrorDiagnosticV1["reasons"] = [];
    for (let index = 0; index < input.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(input, index.toString());
      if (!entry || !("value" in entry)) return null;
      const reason = reasons.find((known) => known === entry.value);
      if (reason === undefined) return null;
      projected.push(reason);
    }
    return {
      schemaVersion: "np.site-build-application-error-diagnostic.v1",
      reasons: projected,
      truncated: truncated.value,
    };
  } catch {
    return null;
  }
}
