export const NP_DEFAULT_SITE_ID = "default";
export const npSiteIdPattern = "^[a-z][a-z0-9-]{0,62}$";

const SITE_ID_PATTERN = new RegExp(npSiteIdPattern, "u");

/** Return whether `value` is a canonical persisted/runtime site identifier. */
export function npIsCanonicalSiteId(value: unknown): value is string {
  return typeof value === "string" && SITE_ID_PATTERN.test(value);
}
